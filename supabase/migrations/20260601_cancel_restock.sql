-- ==============================================================================================
-- cancel_restock: hủy một phiếu nhập kho HOẶC một phiếu hiệu chỉnh tồn, hoàn lại hiện trạng.
--
-- A restock created: expenses(is_refill) row (+qty into warehouse) + expense_payments (cash-out)
-- + a WAC update. A stock adjustment created: expenses(is_refill, adjustment, amount 0) with a
-- ±qty delta and no payment. Cancelling either reverses everything:
--   1. Delete the row → its ±qty leaves the warehouse sum (ON DELETE CASCADE also removes any
--      linked expense_payments, reversing the cash-out for a paid restock).
--   2. Recompute WAC from scratch over the ingredient's REMAINING real purchases (is_refill,
--      not adjustment, amount > 0). Adjustments never affected WAC, so this is a no-op for them.
--   3. Insert a qty=0 / amount=0 audit row ("Đã hủy …") so the cancellation is visible in Nhật ký
--      without affecting stock or money.
--
-- Cannot cancel a cancel-marker row (metadata.cancel_restock = true) — nothing to reverse.
-- Stock reverts purely via the delete; both aggregators (get_ingredient_stocks_v2 + JS fallback)
-- sum metadata.qty over is_refill rows, so no aggregator change is needed.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION cancel_restock(
    p_address_id UUID,
    p_expense_id UUID,
    p_staff_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient    TEXT;
    v_qty           NUMERIC;
    v_is_refill     BOOLEAN;
    v_is_adjustment BOOLEAN;
    v_is_cancel     BOOLEAN;
    v_display_name  TEXT;
    v_total_qty     NUMERIC;
    v_total_cost    NUMERIC;
    v_new_unit_cost NUMERIC;
    v_before_stock  NUMERIC;
BEGIN
    IF p_address_id IS NULL OR p_expense_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_expense_id are required';
    END IF;

    -- Ownership guard (mirrors process_ingredient_restock). Skip for service_role/migrations.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Load + validate the target row.
    SELECT (metadata->>'ingredient')::TEXT,
           COALESCE((metadata->>'qty')::NUMERIC, 0),
           is_refill,
           COALESCE((metadata->>'adjustment')::BOOLEAN, false),
           COALESCE((metadata->>'cancel_restock')::BOOLEAN, false)
    INTO v_ingredient, v_qty, v_is_refill, v_is_adjustment, v_is_cancel
    FROM expenses
    WHERE id = p_expense_id AND address_id = p_address_id;

    IF v_ingredient IS NULL THEN
        RAISE EXCEPTION 'Entry % not found for address %', p_expense_id, p_address_id;
    END IF;
    -- Both restocks and stock adjustments are cancellable; only the cancel-marker
    -- audit rows (which have nothing to reverse) are rejected.
    IF NOT v_is_refill OR v_is_cancel THEN
        RAISE EXCEPTION 'Entry % is not a cancellable restock/adjustment', p_expense_id;
    END IF;

    -- Warehouse balance BEFORE the cancel (for the audit row's Tồn snapshot).
    WITH refills AS (
        SELECT created_at, COALESCE((metadata->>'qty')::NUMERIC, 0) AS qty
        FROM expenses
        WHERE address_id = p_address_id AND is_refill = true
          AND metadata->>'ingredient' = v_ingredient
    ),
    first_refill AS (SELECT MIN(created_at) AS first_at FROM refills WHERE qty IS NOT NULL),
    restocks AS (
        SELECT COALESCE((elem->>'restock')::NUMERIC, 0) AS qty
        FROM shift_closings sc, jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id AND sc.inventory_report IS NOT NULL
          AND (elem->>'ingredient')::TEXT = v_ingredient
          AND sc.created_at >= (SELECT first_at FROM first_refill)
    )
    SELECT ROUND(GREATEST(0,
        COALESCE((SELECT SUM(qty) FROM refills), 0) - COALESCE((SELECT SUM(qty) FROM restocks), 0)
    )::numeric, 1)
    INTO v_before_stock;

    -- 1. Delete the row (CASCADE removes its expense_payments → reverses any cash-out).
    DELETE FROM expenses WHERE id = p_expense_id AND address_id = p_address_id;

    -- 2. Recompute WAC over the REMAINING real purchases (exclude adjustments + amount=0).
    SELECT COALESCE(SUM(COALESCE((metadata->>'qty')::NUMERIC, 0)), 0),
           COALESCE(SUM(amount), 0)
    INTO v_total_qty, v_total_cost
    FROM expenses
    WHERE address_id = p_address_id AND is_refill = true
      AND metadata->>'ingredient' = v_ingredient
      AND COALESCE((metadata->>'adjustment')::BOOLEAN, false) = false
      AND amount > 0;

    IF v_total_qty > 0 THEN
        v_new_unit_cost := ROUND(v_total_cost / v_total_qty);
        UPDATE ingredient_costs SET unit_cost = v_new_unit_cost
        WHERE address_id = p_address_id AND ingredient = v_ingredient;
    ELSE
        v_new_unit_cost := NULL; -- no purchases left; leave unit_cost untouched
    END IF;

    -- 3. Audit row — qty 0 (stock-neutral), amount 0 (money-neutral). after_stock reverses the
    --    cancelled delta: before − v_qty works for both signs (a −454 adjustment → before + 454).
    v_display_name := CASE WHEN v_is_adjustment
        THEN 'Đã hủy hiệu chỉnh ' || INITCAP(REPLACE(v_ingredient, '_', ' '))
        ELSE 'Đã hủy phiếu nhập ' || INITCAP(REPLACE(v_ingredient, '_', ' '))
    END;
    INSERT INTO expenses (
        address_id, name, amount, is_fixed, is_refill, payment_method,
        staff_name, metadata
    ) VALUES (
        p_address_id, v_display_name, 0, false, true, 'cash',
        p_staff_name,
        jsonb_build_object(
            'ingredient',     v_ingredient,
            'qty',            0,
            'adjustment',     true,
            'cancel_restock', true,
            'cancelled_qty',  v_qty,
            'before_stock',   v_before_stock,
            'after_stock',    ROUND(GREATEST(0, v_before_stock - v_qty)::numeric, 1)
        )
    );

    RETURN jsonb_build_object(
        'success',       true,
        'ingredient',    v_ingredient,
        'cancelled_qty', v_qty,
        'was_adjustment', v_is_adjustment,
        'new_unit_cost', v_new_unit_cost
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) TO authenticated;

COMMIT;
