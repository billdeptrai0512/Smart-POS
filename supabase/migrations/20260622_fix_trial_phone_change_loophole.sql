-- ============================================================
-- Vá kẽ hở trial khi ĐỔI SĐT — 2026-06-22
--
-- Trước đây set_my_phone() khi đổi số (phone cũ ≠ NULL) chỉ update số rồi
-- return, KHÔNG ghi số mới vào trial_grants. Hệ quả: số mới chưa "bị đốt" →
-- nếu user tạo chi nhánh mới, trigger grant_trial_on_address_creation cấp
-- thêm 7 ngày trial. Tức đổi sang số chưa dùng = mở lại trial.
--
-- Fix: khi đổi số, nếu account ĐÃ tiêu trial (số cũ có trong trial_grants HOẶC
-- còn sub note='trial') → copy vết đốt sang số MỚI → số mới cũng bị khoá
-- 1-SĐT-1-trial. Account chưa từng trial → không copy gì (đúng).
--
-- Giữ nguyên: chuẩn hoá E.164, ownership guard (auth.uid()), SET search_path.
-- IDEMPOTENT.
--
-- + Vá kẽ hở GỐC RỄ: trial_grants.address_id đang NOT NULL + ON DELETE CASCADE.
--   deleteAddress() là hard-delete → xoá đúng address nhận trial sẽ cascade xoá luôn
--   bản ghi trial_grants → số hết "bị đốt" → tạo address mới = trial lại. Đổi sang
--   nullable + ON DELETE SET NULL để vết đốt BỀN VỮNG, không phụ thuộc address.
-- ============================================================

-- ── Vết đốt bền vững: xoá address không được xoá bản ghi trial_grants ───────────
ALTER TABLE trial_grants ALTER COLUMN address_id DROP NOT NULL;
ALTER TABLE trial_grants DROP CONSTRAINT IF EXISTS trial_grants_address_id_fkey;
ALTER TABLE trial_grants ADD CONSTRAINT trial_grants_address_id_fkey
    FOREIGN KEY (address_id) REFERENCES addresses(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION set_my_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone      TEXT;
    v_user       users%ROWTYPE;
    v_trial_addr UUID;
    v_trial_to   DATE;
    v_addr       UUID;
BEGIN
    -- Chuẩn hoá về E.164 +84xxxxxxxxx (kiểu libphonenumber, region VN).
    v_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    IF v_phone ~ '^00' THEN
        v_phone := substr(v_phone, 3);
    END IF;
    IF v_phone ~ '^840\d{9}$' THEN
        v_phone := substr(v_phone, 3);
    ELSIF v_phone ~ '^84\d{9}$' THEN
        v_phone := '0' || substr(v_phone, 3);
    END IF;
    IF v_phone !~ '^0[35789]\d{8}$' THEN
        RAISE EXCEPTION 'Số điện thoại không hợp lệ — cần số di động VN 10 số (vd: 0902822192)';
    END IF;
    v_phone := '+84' || substr(v_phone, 2);

    SELECT * INTO v_user FROM users WHERE auth_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy tài khoản';
    END IF;
    IF v_user.phone = v_phone THEN
        RETURN 'ok';  -- không đổi gì
    END IF;

    IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone AND id <> v_user.id) THEN
        RAISE EXCEPTION 'Số điện thoại đã được dùng cho tài khoản khác';
    END IF;

    UPDATE users SET phone = v_phone WHERE id = v_user.id;

    -- Đổi số (đã có phone trước đó): nếu account ĐÃ tiêu trial — qua trial_grants của
    -- số cũ HOẶC còn sub note='trial' (bắt cả tài khoản đã đổi số dưới code cũ) — thì
    -- đốt luôn số mới, chống đổi-số-để-mở-lại-trial. Chưa tiêu trial → không đốt.
    IF v_user.phone IS NOT NULL THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        SELECT v_phone, address_id, expires_at FROM (
            SELECT address_id, expires_at
              FROM trial_grants WHERE phone = v_user.phone
            UNION ALL
            SELECT s.address_id, s.valid_to::timestamptz
              FROM address_subscriptions s
              JOIN addresses a ON a.id = s.address_id
             WHERE a.manager_id = v_user.id AND s.note = 'trial'
        ) src
        LIMIT 1
        ON CONFLICT (phone) DO NOTHING;
        RETURN 'ok';
    END IF;

    -- (a) SĐT đã từng nhận trial → thôi.
    IF EXISTS (SELECT 1 FROM trial_grants WHERE phone = v_phone) THEN
        RETURN 'ok';
    END IF;

    -- (b) Account đã từng nhận trial (cấp theo account trước đây) → bind vào SĐT.
    SELECT s.address_id, s.valid_to INTO v_trial_addr, v_trial_to
      FROM address_subscriptions s
      JOIN addresses a ON a.id = s.address_id
     WHERE a.manager_id = v_user.id AND s.note = 'trial'
     LIMIT 1;
    IF FOUND THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, v_trial_addr, v_trial_to::timestamptz)
        ON CONFLICT (phone) DO NOTHING;
        RETURN 'ok';
    END IF;

    -- (c) Có address chưa từng có gói 'all' → cấp trial 7 ngày.
    SELECT a.id INTO v_addr
      FROM addresses a
     WHERE a.manager_id = v_user.id
       AND NOT EXISTS (
            SELECT 1 FROM address_subscriptions s
            WHERE s.address_id = a.id AND s.tier = 'all'
       )
     LIMIT 1;
    IF FOUND THEN
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES (v_addr, 'all', CURRENT_DATE, CURRENT_DATE + 7, 0, 'trial');
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, v_addr, now() + interval '7 days')
        ON CONFLICT (phone) DO NOTHING;
        RETURN 'trial_granted';
    END IF;

    -- (d) Chưa có address → trigger lo khi tạo address đầu tiên.
    RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_phone(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_phone(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_my_phone(TEXT) TO authenticated;
