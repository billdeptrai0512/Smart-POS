-- ============================================================
-- Monetization — vá 2 việc còn lại của payment backend — 2026-06-11
--
--   1. confirm_payment check app_config (MONETIZATION.md §9):
--      server kill switch OFF → từ chối ghi sub, tránh data rác từ
--      webhook/CK test lẫn vào prod (PROD + DEV CHUNG 1 DB).
--      Webhook nhận 'monetization_disabled' → trả 200 (SePay không retry);
--      tiền đã vào tài khoản thì admin đối soát tay bằng admin_set_subscription.
--
--   2. Cron dọn intent pending quá hạn → status='expired' (pg_cron, mỗi giờ).
--      confirm_payment đã tự chặn intent quá hạn khi webhook đến; cron chỉ
--      dọn bảng cho sạch để trang đối soát sau này không hiện intent chết.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

-- ── 1. confirm_payment — thêm check kill switch ĐẦU function ──────────────────
-- Phần còn lại giữ nguyên 20260610_sepay_payment_webhook.sql.
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

-- ── 2. Cron dọn intent pending quá hạn (mỗi giờ) ───────────────────────────────
-- pg_cron có sẵn trên Supabase. cron.schedule cùng tên job → ghi đè (idempotent).
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
    'expire-stale-payment-intents',
    '0 * * * *',
    $$ UPDATE public.payment_intents
          SET status = 'expired'
        WHERE status = 'pending' AND expires_at < now() $$
);
