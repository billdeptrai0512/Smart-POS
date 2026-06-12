-- ==============================================================================================
-- Fix: record_invoice_payment từ chối thanh toán CÙNG NGÀY với ngày tạo hoá đơn.
--
-- Bug: client neo paid_at ở 12:00 trưa VN (anchor deterministic — InvoicePaymentSheet),
-- còn RPC so sánh TIMESTAMP: paid_at < invoice.created_at - 1'. Hoá đơn tạo sau 12h trưa
-- (vd 12:09) → trả cùng ngày (12:00) bị reject:
--   "paid_at (2026-06-11 05:00:00+00) cannot be before invoice created_at (2026-06-11 05:09:13+00)"
--
-- Ý định nghiệp vụ là chặn trả trước NGÀY nhập hàng (kế toán theo ngày), không phải trước
-- từng phút → đổi so sánh sang NGÀY theo múi giờ VN.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION record_invoice_payment(
    p_expense_id     UUID,
    p_amount         NUMERIC,
    p_payment_method TEXT DEFAULT 'cash',
    p_staff_name     TEXT DEFAULT NULL,
    p_paid_at        TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_id      UUID;
    v_invoice_amount  NUMERIC;
    v_invoice_created TIMESTAMPTZ;
    v_paid_total      NUMERIC;
    v_paid_at         TIMESTAMPTZ;
    v_payment_id      UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
    END IF;

    -- Lấy invoice (RLS sẽ chặn nếu caller không quyền access)
    SELECT address_id, amount, created_at
    INTO v_address_id, v_invoice_amount, v_invoice_created
    FROM expenses
    WHERE id = p_expense_id AND is_refill = true;

    IF v_address_id IS NULL THEN
        RAISE EXCEPTION 'invoice not found or not a refill';
    END IF;

    v_paid_at := COALESCE(p_paid_at, NOW());

    -- Chặn backdate sang trước NGÀY nhập (so theo ngày VN, không so timestamp:
    -- client neo paid_at = 12:00 trưa VN nên trả cùng ngày luôn hợp lệ).
    IF (v_paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         < (v_invoice_created AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before invoice date (%)',
            v_paid_at, (v_invoice_created AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    END IF;

    -- Chặn overpay: tổng đã trả + lần này không vượt invoice.amount.
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM expense_payments WHERE expense_id = p_expense_id;

    IF v_paid_total + p_amount > v_invoice_amount THEN
        RAISE EXCEPTION 'overpay: paid_total (% + %) would exceed invoice amount (%)',
            v_paid_total, p_amount, v_invoice_amount;
    END IF;

    INSERT INTO expense_payments (
        expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at
    ) VALUES (
        p_expense_id,
        v_address_id,
        p_amount,
        COALESCE(p_payment_method, 'cash'),
        p_staff_name,
        v_paid_at,
        v_paid_at
    ) RETURNING id INTO v_payment_id;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id);
END;
$$;

COMMIT;
