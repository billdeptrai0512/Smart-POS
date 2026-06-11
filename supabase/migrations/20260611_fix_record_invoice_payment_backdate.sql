-- ==============================================================================================
-- Fix: backdated record_invoice_payment check constraint violation.
--
-- Bug: record_invoice_payment inserts into expense_payments with paid_at set but created_at
-- defaulting to NOW(). The constraint chk_payment_paid_at_not_before_created then rejects the row
-- if paid_at is backdated.
--
-- Fix: set created_at = v_paid_at in record_invoice_payment INSERT.
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

    -- Chặn backdate sang trước ngày nhập (kế toán bug). Buffer 1 phút cho clock skew.
    IF v_paid_at < v_invoice_created - interval '1 minute' THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before invoice created_at (%)', v_paid_at, v_invoice_created;
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
