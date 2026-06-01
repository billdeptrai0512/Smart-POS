-- ==============================================================================================
-- Fix: backdated restock fails with check-constraint violation on expense_payments.
--
-- Bug: process_ingredient_restock inserted the expense_payments row with paid_at = the backdated
-- date but WITHOUT setting created_at, so created_at defaulted to NOW(). The constraint
-- chk_payment_paid_at_not_before_created (paid_at >= created_at - 1min) then failed for any
-- past purchase date — "Nhập kho" with a date in the past was impossible.
--
-- Fix: a backdated restock is a transaction that happened in the past, so the payment row's
-- created_at must be backdated to the same instant as paid_at (= COALESCE(p_paid_at, v_created_at)).
-- Only the expense_payments INSERT changes; the rest of the function is unchanged.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION process_ingredient_restock(
    p_address_id    UUID,
    p_ingredient    TEXT,
    p_qty           NUMERIC,
    p_subtotal      NUMERIC,
    p_staff_name    TEXT,
    p_created_at    TIMESTAMPTZ DEFAULT NULL,
    p_discount      NUMERIC DEFAULT 0,
    p_extra_cost    NUMERIC DEFAULT 0,
    p_initial_payment NUMERIC DEFAULT NULL,
    p_payment_method TEXT DEFAULT 'cash',
    p_paid_at       TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_stock NUMERIC;
    v_old_unit_cost NUMERIC;
    v_new_unit_cost NUMERIC;
    v_expense_id    UUID;
    v_payment_id    UUID;
    v_display_name  TEXT;
    v_amount        NUMERIC;
    v_paid          NUMERIC;
    v_created_at    TIMESTAMPTZ;
    v_paid_at       TIMESTAMPTZ;
    v_before_stock  NUMERIC;
    v_after_stock   NUMERIC;
BEGIN
    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'discount cannot be negative (got %)', p_discount;
    END IF;
    IF COALESCE(p_extra_cost, 0) < 0 THEN
        RAISE EXCEPTION 'extra_cost cannot be negative (got %)', p_extra_cost;
    END IF;
    v_amount     := COALESCE(p_subtotal, 0) - COALESCE(p_discount, 0) + COALESCE(p_extra_cost, 0);
    IF v_amount < 0 THEN v_amount := 0; END IF;
    v_paid       := COALESCE(p_initial_payment, v_amount);
    IF v_paid < 0 THEN v_paid := 0; END IF;
    IF v_paid > v_amount THEN v_paid := v_amount; END IF;
    v_created_at := COALESCE(p_created_at, NOW());
    -- Payment instant defaults to the (possibly backdated) created_at, so a backdated
    -- restock keeps paid_at and created_at on the SAME past day — satisfying the
    -- expense_payments check constraint instead of pinning created_at to NOW().
    v_paid_at    := COALESCE(p_paid_at, v_created_at);
    IF v_paid_at < v_created_at - interval '1 minute' THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before created_at (%)', v_paid_at, v_created_at;
    END IF;

    -- 1. Tồn hiện tại (counter remaining từ shift_closing gần nhất).
    SELECT COALESCE(
        (SELECT (elem->>'remaining')::NUMERIC
         FROM jsonb_array_elements(inventory_report) AS elem
         WHERE (elem->>'ingredient')::TEXT = p_ingredient
         LIMIT 1),
        0
    )
    INTO v_current_stock
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_current_stock IS NULL OR v_current_stock < 0 THEN v_current_stock := 0; END IF;

    -- Snapshot warehouse-side. The RPC's v_current_stock above is the COUNTER
    -- (latest shift_closing remaining). For Nhật ký's "Tồn X → Y" we want the
    -- WAREHOUSE balance, which is Σ refills − Σ restocks-to-counter on or after
    -- the first refill. Use the same recipe fetchIngredientStocks does.
    WITH refills AS (
        SELECT created_at, COALESCE((metadata->>'qty')::NUMERIC, 0) AS qty
        FROM expenses
        WHERE address_id = p_address_id
          AND is_refill = true
          AND metadata->>'ingredient' = p_ingredient
    ),
    first_refill AS (
        SELECT MIN(created_at) AS first_at FROM refills WHERE qty IS NOT NULL
    ),
    restocks AS (
        SELECT COALESCE((elem->>'restock')::NUMERIC, 0) AS qty
        FROM shift_closings sc, jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND (elem->>'ingredient')::TEXT = p_ingredient
          AND sc.created_at >= (SELECT first_at FROM first_refill)
    )
    SELECT ROUND(GREATEST(
        0,
        COALESCE((SELECT SUM(qty) FROM refills), 0)
            - COALESCE((SELECT SUM(qty) FROM restocks), 0)
    )::numeric, 1)
    INTO v_before_stock;

    v_after_stock := ROUND(v_before_stock + COALESCE(p_qty, 0), 1);

    -- 2. Giá vốn hiện tại
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. WAC dùng v_amount
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + v_amount) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

    INSERT INTO expenses (
        address_id, name, amount, is_fixed, is_refill, payment_method,
        staff_name, metadata, discount_amount, extra_cost, created_at
    ) VALUES (
        p_address_id,
        v_display_name,
        v_amount,
        false,
        true,
        p_payment_method,
        p_staff_name,
        jsonb_build_object(
            'ingredient',    p_ingredient,
            'qty',           p_qty,
            'subtotal',      p_subtotal,
            'old_unit_cost', v_old_unit_cost,
            'new_unit_cost', v_new_unit_cost,
            'before_stock',  v_before_stock,
            'after_stock',   v_after_stock
        ),
        COALESCE(p_discount, 0),
        COALESCE(p_extra_cost, 0),
        v_created_at
    ) RETURNING id INTO v_expense_id;

    IF v_paid > 0 THEN
        -- created_at backdated alongside paid_at so the past-purchase payment row
        -- satisfies chk_payment_paid_at_not_before_created.
        INSERT INTO expense_payments (
            expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at
        ) VALUES (
            v_expense_id,
            p_address_id,
            v_paid,
            COALESCE(p_payment_method, 'cash'),
            p_staff_name,
            v_paid_at,
            v_paid_at
        ) RETURNING id INTO v_payment_id;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'expense_id',    v_expense_id,
        'payment_id',    v_payment_id,
        'amount',        v_amount,
        'paid',          v_paid,
        'owing',         v_amount - v_paid,
        'old_unit_cost', v_old_unit_cost,
        'new_unit_cost', v_new_unit_cost,
        'before_stock',  v_before_stock,
        'after_stock',   v_after_stock
    );
END;
$$;

COMMIT;
