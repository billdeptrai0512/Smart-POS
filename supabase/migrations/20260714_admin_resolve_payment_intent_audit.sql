-- ============================================================
-- Đối soát thanh toán — audit ai bấm Cấp gói/Bỏ qua. Có >1 admin dùng
-- trang /admin/reconciliation nên cần biết ai đã xử lý 1 payment_intent,
-- không chỉ biết NÓ đã được xử lý (trước đây note cứng 'admin_reconcile',
-- không gắn actor).
--
-- resolved_by lưu users.id (không phải auth.uid() thô) — đúng pattern FK
-- hiện có (addresses.manager_id references users(id)). Dùng
-- public.auth_owner_id(auth.uid()) để quy đổi: với tài khoản admin (không
-- có manager_id) hàm này trả về COALESCE(manager_id, id) = chính id của
-- admin đó.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE. Production-safe.
-- ============================================================

ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);

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
        UPDATE payment_intents
        SET status = 'paid', paid_at = now(), resolved_by = public.auth_owner_id(auth.uid())
        WHERE id = p_intent_id;
        RETURN 'granted';
    ELSE
        UPDATE payment_intents
        SET status = 'cancelled', resolved_by = public.auth_owner_id(auth.uid())
        WHERE id = p_intent_id;
        RETURN 'dismissed';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_resolve_payment_intent(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_payment_intent(UUID, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_resolve_payment_intent(UUID, BOOLEAN) TO authenticated;
