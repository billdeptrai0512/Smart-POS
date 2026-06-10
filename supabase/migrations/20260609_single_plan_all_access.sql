-- ============================================================
-- Monetization — gộp 2 module → 1 gói all-access (2026-06-09)
-- Bỏ bán lẻ từng báo cáo. 1 gói duy nhất (tier='all') mở khoá CẢ 3 view:
-- Dòng tiền + Lợi nhuận + Tồn kho. Giá 888,888đ / 6 tháng / địa chỉ (giá ở client).
-- Trial: 7 ngày (kéo từ 3 → 7 để chủ quán thấy đủ dữ liệu trước khi cam kết 6 tháng).
--
-- ⚠️ PROD + DEV CHUNG 1 DB — sửa trigger trial TRƯỚC khi đổi CHECK.
-- Bảng sub/intent đang rỗng (chưa có khách trả tiền) → convert an toàn.
-- IDEMPOTENT.
-- ============================================================

-- ── 1. Trigger trial: cấp 1 row 'all', 7 ngày ─────────────────────────────────
CREATE OR REPLACE FUNCTION grant_trial_on_address_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_count INT;
BEGIN
    SELECT COUNT(*) INTO v_address_count
    FROM addresses
    WHERE manager_id = NEW.manager_id;

    IF v_address_count = 1 THEN
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES (NEW.id, 'all', CURRENT_DATE, CURRENT_DATE + 7, 0, 'trial');
    END IF;

    RETURN NEW;
END;
$$;

-- ── 2. Gỡ CHECK cũ (cashflow/inventory) ───────────────────────────────────────
ALTER TABLE address_subscriptions DROP CONSTRAINT IF EXISTS address_subscriptions_tier_check;
ALTER TABLE payment_intents       DROP CONSTRAINT IF EXISTS payment_intents_tier_check;

-- ── 3. Convert dữ liệu test cũ → 'all' ─────────────────────────────────────────
-- (Có thể sinh nhiều row 'all'/address — vô hại; get_address_entitlement GROUP BY tier.)
UPDATE address_subscriptions SET tier = 'all' WHERE tier <> 'all';
UPDATE payment_intents       SET tier = 'all' WHERE tier <> 'all';

-- ── 4. CHECK mới: chỉ còn 'all' ────────────────────────────────────────────────
ALTER TABLE address_subscriptions
    ADD CONSTRAINT address_subscriptions_tier_check CHECK (tier IN ('all'));
ALTER TABLE payment_intents
    ADD CONSTRAINT payment_intents_tier_check CHECK (tier IN ('all'));

-- ── 5. admin_set_subscription: validate 'all' (thay vì cashflow/inventory) ─────
CREATE OR REPLACE FUNCTION admin_set_subscription(
    p_address_ids UUID[],
    p_modules     TEXT[],
    p_months      INT  DEFAULT 1,
    p_amount_paid INT  DEFAULT 0,
    p_note        TEXT DEFAULT 'admin_override'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_addr  UUID;
    v_mod   TEXT;
    v_from  DATE;
    v_to    DATE;
    v_count INT := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được cấp gói thủ công'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_months IS NULL OR p_months < 1 THEN
        RAISE EXCEPTION 'p_months phải >= 1';
    END IF;
    IF p_address_ids IS NULL OR array_length(p_address_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Cần ít nhất 1 chi nhánh';
    END IF;
    IF p_modules IS NULL OR array_length(p_modules, 1) IS NULL THEN
        RAISE EXCEPTION 'Cần ít nhất 1 gói';
    END IF;

    FOREACH v_addr IN ARRAY p_address_ids LOOP
        FOREACH v_mod IN ARRAY p_modules LOOP
            IF v_mod <> 'all' THEN
                RAISE EXCEPTION 'Gói không hợp lệ: %', v_mod;
            END IF;

            -- Quy tắc gia hạn nối tiếp (§4)
            SELECT COALESCE(MAX(valid_to), CURRENT_DATE - 1) + 1
              INTO v_from
              FROM address_subscriptions
             WHERE address_id = v_addr AND tier = v_mod;

            IF v_from < CURRENT_DATE THEN
                v_from := CURRENT_DATE;
            END IF;

            v_to := (v_from + (p_months || ' months')::interval)::date;

            INSERT INTO address_subscriptions
                (address_id, tier, valid_from, valid_to, months, amount_paid, note)
            VALUES
                (v_addr, v_mod, v_from, v_to, p_months, COALESCE(p_amount_paid, 0), p_note);

            v_count := v_count + 1;
        END LOOP;
    END LOOP;

    RETURN v_count;
END;
$$;
