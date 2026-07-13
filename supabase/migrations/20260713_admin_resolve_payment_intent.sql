-- ============================================================
-- Admin reconciliation — resolve 1 payment_intent kẹt (pending>30' nghi
-- webhook miss, hoặc manual_review lệch tiền) từ dashboard đối soát.
--
-- Tái dùng admin_set_subscription() cho phần cấp gói (PERFORM) thay vì
-- chép lại logic gia hạn nối tiếp — chỉ thêm phần đóng trạng thái intent
-- (RLS payment_intents chỉ có policy SELECT, không có UPDATE cho client).
--
-- p_grant=true  → cấp gói (address_ids/months/amount của intent) + status='paid'.
-- p_grant=false → không cấp, chỉ đóng status='cancelled' (đã đối soát tay,
--                 xác định không có tiền vào / không cần cấp).
--
-- IDEMPOTENT: CREATE OR REPLACE. Production-safe.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_resolve_payment_intent(
    p_intent_id UUID,
    p_grant     BOOLEAN DEFAULT true
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_intent payment_intents%ROWTYPE;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được đối soát thủ công'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_intent FROM payment_intents WHERE id = p_intent_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy giao dịch';
    END IF;
    IF v_intent.status NOT IN ('pending', 'manual_review') THEN
        RAISE EXCEPTION 'Giao dịch đã được xử lý trước đó (status=%)', v_intent.status;
    END IF;

    IF p_grant THEN
        PERFORM admin_set_subscription(
            COALESCE(v_intent.address_ids, ARRAY[v_intent.address_id]),
            ARRAY['all'],
            v_intent.months,
            v_intent.amount,
            'admin_reconcile'
        );
        UPDATE payment_intents SET status = 'paid', paid_at = now() WHERE id = p_intent_id;
        RETURN 'granted';
    ELSE
        UPDATE payment_intents SET status = 'cancelled' WHERE id = p_intent_id;
        RETURN 'dismissed';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_resolve_payment_intent(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_payment_intent(UUID, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_resolve_payment_intent(UUID, BOOLEAN) TO authenticated;
