-- ==============================================================================================
-- edit_ingredient_restock: sửa một phiếu nhập kho tại chỗ (KHÔNG hủy + tạo lại).
--
-- Cải tiến v2 (2026-06-16):
--   [Fix 1] Validate v_amount > 0 — tránh WAC undercount khi discount quá lớn.
--   [Fix 2] cash_phase: kiểm tra cột tồn tại trước khi INSERT (degrade gracefully).
--   [Impr ] Audit trail: ghi edited_at + edited_by vào metadata.
--   [Impr ] Delta cascade: shift before/after_stock của các phiếu SAU theo qty_delta
--           (đúng toán học khi withdrawals không thay đổi).
--
-- REQUIRES (chạy trước file này):
--   • 20260612_invoice_payment_cash_phase.sql  (cột expense_payments.cash_phase)
--   • 20260612_security_advisor_fixes.sql      (ownership guard pattern)
--
-- WAC: full re-average kiểu cancel_restock — tất định, không phụ thuộc thứ tự sửa.
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION edit_ingredient_restock(
    p_address_id      UUID,
    p_expense_id      UUID,
    p_qty             NUMERIC,
    p_subtotal        NUMERIC,
    p_discount        NUMERIC,
    p_extra_cost      NUMERIC,
    p_initial_payment NUMERIC,
    p_payment_method  TEXT,
    p_cash_phase      TEXT,
    p_created_at      TIMESTAMPTZ,
    p_staff_name      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient    TEXT;
    v_before_stock  NUMERIC;
    v_original_qty  NUMERIC;
    v_qty_delta     NUMERIC;
    v_meta          JSONB;
    v_is_refill     BOOLEAN;
    v_is_adjustment BOOLEAN;
    v_is_cancelled  BOOLEAN;
    v_amount        NUMERIC;
    v_paid          NUMERIC;
    v_paid_at       TIMESTAMPTZ;
    v_cash_phase    TEXT;
    v_after_stock   NUMERIC;
    v_total_qty     NUMERIC;
    v_total_cost    NUMERIC;
    v_new_unit_cost NUMERIC;
    v_payment_id    UUID;
    v_has_cash_phase_col BOOLEAN;
BEGIN
    IF p_address_id IS NULL OR p_expense_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_expense_id are required';
    END IF;

    -- Ownership guard (pattern 20260520/20260612). Skip service_role/migrations.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Load + lock row (concurrent edit/cancel cannot race).
    SELECT (metadata->>'ingredient')::TEXT,
           COALESCE((metadata->>'before_stock')::NUMERIC, 0),
           COALESCE((metadata->>'qty')::NUMERIC, 0),
           metadata,
           is_refill,
           COALESCE((metadata->>'adjustment')::BOOLEAN, false),
           COALESCE((metadata->>'cancelled')::BOOLEAN, false)
    INTO v_ingredient, v_before_stock, v_original_qty, v_meta,
         v_is_refill, v_is_adjustment, v_is_cancelled
    FROM expenses
    WHERE id = p_expense_id AND address_id = p_address_id
    FOR UPDATE;

    IF v_ingredient IS NULL THEN
        RAISE EXCEPTION 'Entry % not found for address %', p_expense_id, p_address_id;
    END IF;
    IF NOT v_is_refill THEN
        RAISE EXCEPTION 'Entry % is not a restock', p_expense_id;
    END IF;
    IF v_is_adjustment THEN
        RAISE EXCEPTION 'Cannot edit adjustment entry %', p_expense_id;
    END IF;
    IF v_is_cancelled THEN
        RAISE EXCEPTION 'Cannot edit cancelled entry %', p_expense_id;
    END IF;

    -- Validate input.
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be > 0 (got %)', p_qty;
    END IF;
    IF p_subtotal <= 0 THEN
        RAISE EXCEPTION 'Subtotal must be > 0 (got %)', p_subtotal;
    END IF;
    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'Discount cannot be negative (got %)', p_discount;
    END IF;
    IF COALESCE(p_extra_cost, 0) < 0 THEN
        RAISE EXCEPTION 'Extra cost cannot be negative (got %)', p_extra_cost;
    END IF;

    v_amount := p_subtotal - COALESCE(p_discount, 0) + COALESCE(p_extra_cost, 0);
    IF v_amount < 0 THEN v_amount := 0; END IF;

    -- [Fix 1] Prevent zero-amount rows — WAC query filters `amount > 0`, so a zero-amount
    -- row would add qty to stock while being silently excluded from WAC (undercount).
    IF v_amount <= 0 THEN
        RAISE EXCEPTION
            'Net amount must be > 0 (subtotal=%, discount=%, extra=%). Reduce discount.',
            p_subtotal, p_discount, p_extra_cost;
    END IF;

    v_paid := COALESCE(p_initial_payment, v_amount);
    IF v_paid < 0 THEN v_paid := 0; END IF;
    IF v_paid > v_amount THEN v_paid := v_amount; END IF;

    v_qty_delta   := p_qty - v_original_qty;
    v_after_stock := v_before_stock + p_qty;
    v_cash_phase  := NULLIF(COALESCE(p_cash_phase, ''), '');
    v_paid_at     := COALESCE(p_created_at, NOW());

    -- 1. UPDATE expense row (with audit trail).
    UPDATE expenses SET
        amount          = v_amount,
        discount_amount = COALESCE(p_discount, 0),
        extra_cost      = COALESCE(p_extra_cost, 0),
        payment_method  = p_payment_method,
        created_at      = COALESCE(p_created_at, created_at),
        metadata        = v_meta || jsonb_build_object(
            'qty',        p_qty,
            'subtotal',   p_subtotal,
            'cash_phase', COALESCE(v_cash_phase, 'post_close'),
            'after_stock', v_after_stock,
            -- [Impr] Audit trail: ai sửa + khi nào.
            'edited_at',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'edited_by',  p_staff_name
        )
    WHERE id = p_expense_id AND address_id = p_address_id;

    -- 2. [Impr] Delta cascade: khi qty thay đổi, shift before/after_stock của
    --    tất cả các phiếu refill TIẾP THEO (created_at > p_created_at) theo v_qty_delta.
    --    Mathematically correct khi withdrawals (shift_closings) không thay đổi.
    --    Adjustment rows được bỏ qua (amount=0, không ảnh hưởng WAC).
    IF v_qty_delta != 0 THEN
        UPDATE expenses SET
            metadata = jsonb_set(
                jsonb_set(
                    metadata,
                    '{before_stock}',
                    to_jsonb(ROUND(
                        COALESCE((metadata->>'before_stock')::NUMERIC, 0) + v_qty_delta,
                        1
                    ))
                ),
                '{after_stock}',
                to_jsonb(ROUND(
                    COALESCE((metadata->>'after_stock')::NUMERIC, 0) + v_qty_delta,
                    1
                ))
            )
        WHERE address_id = p_address_id
          AND is_refill = true
          AND metadata->>'ingredient' = v_ingredient
          AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
          AND created_at > COALESCE(p_created_at, (
              SELECT created_at FROM expenses WHERE id = p_expense_id
          ));
    END IF;

    -- 3. Reconcile payments: DELETE + INSERT lại 1 payment = min(paid, amount).
    --    Đánh đổi: gộp nhiều lần trả thành 1 (chấp nhận cho v1, ghi chú ở đây).
    DELETE FROM expense_payments WHERE expense_id = p_expense_id;

    IF v_paid > 0 THEN
        -- [Fix 2] Check if cash_phase column exists before including it.
        --  If 20260612_invoice_payment_cash_phase.sql not yet applied, degrade gracefully.
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'expense_payments'
              AND column_name  = 'cash_phase'
        ) INTO v_has_cash_phase_col;

        IF v_has_cash_phase_col THEN
            INSERT INTO expense_payments (
                expense_id, address_id, amount, payment_method,
                staff_name, paid_at, created_at, cash_phase
            ) VALUES (
                p_expense_id, p_address_id, v_paid,
                COALESCE(p_payment_method, 'cash'),
                p_staff_name, v_paid_at, v_paid_at,
                COALESCE(v_cash_phase, 'post_close')
            ) RETURNING id INTO v_payment_id;
        ELSE
            INSERT INTO expense_payments (
                expense_id, address_id, amount, payment_method,
                staff_name, paid_at, created_at
            ) VALUES (
                p_expense_id, p_address_id, v_paid,
                COALESCE(p_payment_method, 'cash'),
                p_staff_name, v_paid_at, v_paid_at
            ) RETURNING id INTO v_payment_id;
        END IF;
    END IF;

    -- 4. Recompute WAC kiểu cancel_restock (full re-average — tất định).
    --    Query chạy SAU UPDATE nên row đang sửa đã có amount + qty mới.
    SELECT COALESCE(SUM(COALESCE((metadata->>'qty')::NUMERIC, 0)), 0),
           COALESCE(SUM(amount), 0)
    INTO v_total_qty, v_total_cost
    FROM expenses
    WHERE address_id = p_address_id
      AND is_refill = true
      AND metadata->>'ingredient' = v_ingredient
      AND COALESCE((metadata->>'adjustment')::BOOLEAN, false) = false
      AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
      AND amount > 0;

    IF v_total_qty > 0 THEN
        v_new_unit_cost := ROUND(v_total_cost / v_total_qty);
        UPDATE ingredient_costs
        SET unit_cost = v_new_unit_cost
        WHERE address_id = p_address_id AND ingredient = v_ingredient;

        -- Sync new_unit_cost vào metadata của row đang sửa (cho display).
        UPDATE expenses
        SET metadata = metadata || jsonb_build_object('new_unit_cost', v_new_unit_cost)
        WHERE id = p_expense_id AND address_id = p_address_id;
    ELSE
        v_new_unit_cost := NULL; -- no purchases left; leave unit_cost untouched
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'expense_id',    p_expense_id,
        'payment_id',    v_payment_id,
        'amount',        v_amount,
        'paid',          v_paid,
        'owing',         v_amount - v_paid,
        'qty_delta',     v_qty_delta,
        'new_unit_cost', v_new_unit_cost
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_ingredient_restock(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_ingredient_restock(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.edit_ingredient_restock(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

COMMIT;
