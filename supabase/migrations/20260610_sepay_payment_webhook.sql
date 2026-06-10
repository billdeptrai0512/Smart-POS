-- ============================================================
-- Monetization — SePay webhook (Phase 3 · part "c") — 2026-06-10
-- Tự động mở khoá khi nhận chuyển khoản, KHÔNG cần admin thao tác tay.
--
-- Luồng:
--   1. Client checkout → create_payment_intent(address_ids, months, amount)
--      → trả 1 reference (số). Nội dung CK = 'SP' || reference.
--   2. User CK qua QR (nội dung đã preset = SPxxxx).
--   3. Bank → SePay → Edge Function `sepay-webhook` (verify HMAC-SHA256).
--   4. Edge Function gọi confirm_payment(reference, amount, sepay_tx_id)
--      → INSERT address_subscriptions (gia hạn nối tiếp §4) cho từng chi nhánh
--      → realtime đẩy về usePaymentListener → tự mở khoá.
--
-- ⚠️ PROD + DEV CHUNG 1 DB. Chỉ thêm cột/ham, không xoá dữ liệu. IDEMPOTENT.
-- ============================================================

-- ── 1. Multi-branch cho payment_intents ───────────────────────────────────────
-- Bảng cũ chỉ có address_id (1 chi nhánh). Checkout multi-branch → 1 CK mở N chi
-- nhánh → cần lưu cả tập. Giữ address_id (= phần tử đầu) cho RLS + back-compat.
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS address_ids UUID[];

-- ── 2. create_payment_intent — sinh reference cho 1 lần checkout ───────────────
-- SECURITY DEFINER: tự guard caller phải quản lý các chi nhánh (hoặc admin).
-- Tái dùng intent pending chưa hết hạn (cùng tập chi nhánh + cùng số tiền) → QR
-- ổn định khi component re-render, không spam intent.
CREATE OR REPLACE FUNCTION create_payment_intent(
    p_address_ids UUID[],
    p_months      INT,
    p_amount      INT
)
RETURNS TEXT                       -- reference (chuỗi số) để ghép 'SP' || reference
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_aid   UUID;
    v_ref   TEXT;
    v_exist TEXT;
BEGIN
    IF p_address_ids IS NULL OR array_length(p_address_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Cần ít nhất 1 chi nhánh';
    END IF;
    IF p_months IS NULL OR p_months < 1 THEN
        RAISE EXCEPTION 'p_months phải >= 1';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'p_amount phải > 0';
    END IF;

    -- Guard quyền: mỗi chi nhánh phải do caller quản lý (skip khi service_role/migration).
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        FOREACH v_aid IN ARRAY p_address_ids LOOP
            IF NOT EXISTS (
                SELECT 1 FROM addresses a
                JOIN users u ON u.id = a.manager_id
                WHERE a.id = v_aid AND u.auth_id = auth.uid()
            ) THEN
                RAISE EXCEPTION 'Không có quyền với chi nhánh %', v_aid
                    USING ERRCODE = 'insufficient_privilege';
            END IF;
        END LOOP;
    END IF;

    -- Tái dùng intent pending còn hạn, cùng tập chi nhánh + cùng số tiền.
    SELECT reference INTO v_exist
      FROM payment_intents
     WHERE status = 'pending'
       AND expires_at > now()
       AND amount = p_amount
       AND address_ids @> p_address_ids
       AND address_ids <@ p_address_ids
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_exist IS NOT NULL THEN
        RETURN v_exist;
    END IF;

    -- Sinh reference số 12 chữ số, đảm bảo unique.
    LOOP
        v_ref := lpad((floor(random() * 1e12))::bigint::text, 12, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM payment_intents WHERE reference = v_ref);
    END LOOP;

    -- 24h (không phải 30'): user hay để màn hình QR mở rồi CK muộn — intent hết hạn
    -- mà tiền đã đi = phải đối soát tay. Giá hiển thị = giá phải trả nên cửa sổ dài an toàn.
    INSERT INTO payment_intents
        (address_id, address_ids, tier, months, amount, reference, status, expires_at)
    VALUES
        (p_address_ids[1], p_address_ids, 'all', p_months, p_amount, v_ref, 'pending',
         now() + interval '24 hours');

    RETURN v_ref;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_payment_intent(UUID[], INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_payment_intent(UUID[], INT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_payment_intent(UUID[], INT, INT) TO authenticated;

-- ── 3. confirm_payment — webhook gọi (service_role) sau khi verify chữ ký ──────
-- Atomic + idempotent. KHÔNG có admin-guard ở đây: bảo vệ nằm ở tầng Edge Function
-- (HMAC-SHA256) + chỉ service_role được EXECUTE.
--   Trả: 'ok' | 'duplicate' | 'no_pending_intent' | 'expired' | 'amount_mismatch'
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
BEGIN
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
