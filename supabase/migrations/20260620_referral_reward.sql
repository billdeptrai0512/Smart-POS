-- ============================================================
-- Referral reward — +1 tháng cho người mời khi địa chỉ được-mời trả tiền lần đầu
-- (docs/MONETIZATION.md §11) — 2026-06-20
--
-- Đơn vị: 1 tháng / mỗi địa chỉ được-mời thanh toán LẦN ĐẦU, cộng vào địa chỉ
-- nguồn (referred_from_address_id). Dedup bằng addresses.referral_rewarded_at
-- (thưởng đúng 1 lần/địa chỉ — tạo 3 nhánh trả 2 thì thưởng 2). Self-funding:
-- chỉ bắn khi đã có tiền thật vào (confirm_payment chỉ chạy cho CK thật).
--
-- Mở rộng confirm_payment (bản 20260611): GIỮ NGUYÊN kill switch + idempotent +
-- gia hạn nối tiếp + grants; chỉ THÊM block thưởng trong vòng FOREACH.
--
-- Clawback (đảo payment thủ công → trừ tháng đã thưởng): CHƯA build vì hiện chưa
-- có cơ chế reverse payment để hook. Thêm khi có admin reverse flow.
--
-- ⚠️ PROD + DEV CHUNG 1 DB. IDEMPOTENT. 1 khối $$ duy nhất.
-- ============================================================

-- ── 1. Cờ dedup: địa chỉ được-mời đã thưởng người mời chưa ──────────────────────
ALTER TABLE addresses
    ADD COLUMN IF NOT EXISTS referral_rewarded_at TIMESTAMPTZ;

-- ── 2. confirm_payment + reward ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_payment(
    p_reference   TEXT,
    p_amount      INT,
    p_sepay_tx_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_intent   payment_intents%ROWTYPE;
    v_addr_ids UUID[];
    v_addr     UUID;
    v_from     DATE;
    v_to       DATE;
    v_each     INT;
    v_ref_src  UUID;   -- địa chỉ nguồn (người mời) của v_addr
    v_rfrom    DATE;   -- gia hạn nối tiếp cho phần thưởng
    v_rto      DATE;
BEGIN
    -- Server kill switch (§9): OFF → không ghi gì cả.
    IF NOT EXISTS (
        SELECT 1 FROM app_config
        WHERE key = 'monetization_enabled' AND value = 'true'
    ) THEN
        RETURN 'monetization_disabled';
    END IF;

    -- Idempotent: webhook retry cùng tx → đã ghi nhận rồi.
    IF p_sepay_tx_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM payment_intents WHERE sepay_tx_id = p_sepay_tx_id
    ) THEN
        RETURN 'duplicate';
    END IF;

    -- Khoá intent pending để tránh race 2 webhook cùng reference.
    SELECT * INTO v_intent
      FROM payment_intents
     WHERE reference = p_reference AND status = 'pending'
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'no_pending_intent';
    END IF;

    IF v_intent.expires_at < now() THEN
        UPDATE payment_intents SET status = 'expired' WHERE id = v_intent.id;
        RETURN 'expired';
    END IF;

    -- Thiếu tiền → không tự cộng, để admin đối soát. Dư tiền → chấp nhận.
    IF p_amount < v_intent.amount THEN
        UPDATE payment_intents
           SET status = 'manual_review', sepay_tx_id = p_sepay_tx_id
         WHERE id = v_intent.id;
        RETURN 'amount_mismatch';
    END IF;

    v_addr_ids := COALESCE(v_intent.address_ids, ARRAY[v_intent.address_id]);
    v_each := (v_intent.amount / GREATEST(array_length(v_addr_ids, 1), 1))::int;

    -- Gia hạn nối tiếp (§4) cho từng chi nhánh — khớp admin_set_subscription.
    FOREACH v_addr IN ARRAY v_addr_ids LOOP
        SELECT COALESCE(MAX(valid_to), CURRENT_DATE - 1) + 1
          INTO v_from
          FROM address_subscriptions
         WHERE address_id = v_addr AND tier = 'all';

        IF v_from < CURRENT_DATE THEN
            v_from := CURRENT_DATE;
        END IF;

        v_to := (v_from + (v_intent.months || ' months')::interval)::date;

        INSERT INTO address_subscriptions
            (address_id, tier, valid_from, valid_to, months, amount_paid, payment_intent_id, note)
        VALUES
            (v_addr, 'all', v_from, v_to, v_intent.months, v_each, v_intent.id, 'paid');

        -- ── Referral reward (§11) ──────────────────────────────────────────────
        -- Claim NGUYÊN TỬ: UPDATE ... WHERE referral_rewarded_at IS NULL khoá hàng
        -- + chỉ 1 transaction match được → chống double-reward khi 2 webhook cùng
        -- địa chỉ chạy song song. Có nguồn (referred_from) + chưa thưởng → tặng
        -- người mời 1 tháng. Renew sau (đã có cờ) hoặc nguồn đã xoá (SET NULL) → bỏ qua.
        -- Cờ vẫn set kể cả self-referral → đánh dấu "đã xét, không thưởng lại".
        UPDATE addresses
           SET referral_rewarded_at = now()
         WHERE id = v_addr
           AND referral_rewarded_at IS NULL
           AND referred_from_address_id IS NOT NULL
        RETURNING referred_from_address_id INTO v_ref_src;

        -- Loại self-referral: nguồn và đích cùng 1 chủ → không thưởng (chỉ thưởng
        -- khi giới thiệu chủ KHÁC). IS DISTINCT FROM an toàn với NULL.
        IF FOUND AND v_ref_src IS NOT NULL
           AND (SELECT manager_id FROM addresses WHERE id = v_ref_src)
               IS DISTINCT FROM
               (SELECT manager_id FROM addresses WHERE id = v_addr)
        THEN
            SELECT COALESCE(MAX(valid_to), CURRENT_DATE - 1) + 1
              INTO v_rfrom
              FROM address_subscriptions
             WHERE address_id = v_ref_src AND tier = 'all';

            IF v_rfrom < CURRENT_DATE THEN
                v_rfrom := CURRENT_DATE;
            END IF;

            v_rto := (v_rfrom + INTERVAL '1 month')::date;

            INSERT INTO address_subscriptions
                (address_id, tier, valid_from, valid_to, months, amount_paid, note)
            VALUES
                (v_ref_src, 'all', v_rfrom, v_rto, 1, 0, 'referral_reward');
        END IF;
    END LOOP;

    UPDATE payment_intents
       SET status = 'paid', paid_at = now(), sepay_tx_id = p_sepay_tx_id
     WHERE id = v_intent.id;

    RETURN 'ok';
END;
$$;

-- Chỉ service_role (Edge Function) được gọi. Không expose cho client.
REVOKE EXECUTE ON FUNCTION public.confirm_payment(TEXT, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(TEXT, INT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_payment(TEXT, INT, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_payment(TEXT, INT, TEXT) TO service_role;
