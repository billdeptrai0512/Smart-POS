-- Fix process_ingredient_restock: v_current_stock previously only read `remaining`
-- from the latest shift_closing's inventory_report (counter stock). That misses:
--   1) warehouse stock (Σ refill_qty − Σ restock_from_closings)
--   2) Any state when the address has no shift_closings yet
--
-- Consequence: weighted-average unit_cost computed as if prior stock = 0, so:
--   v_new_unit_cost = p_total_cost / p_qty
-- every time, ignoring the existing inventory's cost basis. Restocking 1kg @ 250k
-- when 500g @ old_cost still in stock should produce a blended cost, not 250đ/g flat.
--
-- This patch reuses the same formula as get_ingredient_stocks_v2:
--   current_stock = max(0, Σ refill_qty − Σ restock_post_first_refill) + remaining

CREATE OR REPLACE FUNCTION process_ingredient_restock(
    p_address_id UUID,
    p_ingredient TEXT,
    p_qty NUMERIC,
    p_total_cost NUMERIC,
    p_staff_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_warehouse NUMERIC := 0;
    v_counter NUMERIC := 0;
    v_current_stock NUMERIC;
    v_old_unit_cost NUMERIC;
    v_new_unit_cost NUMERIC;
    v_expense_id UUID;
    v_display_name TEXT;
    v_first_refill_at TIMESTAMPTZ;
    v_total_refill NUMERIC := 0;
    v_total_restock NUMERIC := 0;
BEGIN
    -- Ownership guard (unchanged)
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

    -- 1a. Counter stock = remaining of this ingredient in latest closing's inventory_report
    SELECT COALESCE(
        (SELECT (elem->>'remaining')::NUMERIC
         FROM jsonb_array_elements(inventory_report) AS elem
         WHERE (elem->>'ingredient')::TEXT = p_ingredient
         LIMIT 1),
        0
    )
    INTO v_counter
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_counter IS NULL OR v_counter < 0 THEN v_counter := 0; END IF;

    -- 1b. Warehouse stock = Σ refill_qty − Σ restock (from closings after first refill)
    SELECT COALESCE(SUM((metadata->>'qty')::NUMERIC), 0), MIN(created_at)
    INTO v_total_refill, v_first_refill_at
    FROM expenses
    WHERE address_id = p_address_id
      AND is_refill = true
      AND metadata->>'ingredient' = p_ingredient;

    IF v_first_refill_at IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE((elem->>'restock')::NUMERIC, 0)), 0)
        INTO v_total_restock
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND sc.created_at >= v_first_refill_at
          AND (elem->>'ingredient')::TEXT = p_ingredient;
    END IF;

    v_warehouse := GREATEST(0, v_total_refill - v_total_restock);
    v_current_stock := v_warehouse + v_counter;

    -- 2. Current unit cost
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. Weighted average new unit cost (now uses correct prior stock)
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + p_total_cost) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

    INSERT INTO expenses (
        address_id, name, amount, is_fixed, is_refill, payment_method, staff_name, metadata
    ) VALUES (
        p_address_id, v_display_name, p_total_cost, false, true, 'cash', p_staff_name,
        jsonb_build_object(
            'ingredient', p_ingredient,
            'qty', p_qty,
            'price', p_total_cost,
            'old_unit_cost', v_old_unit_cost,
            'new_unit_cost', v_new_unit_cost
        )
    ) RETURNING id INTO v_expense_id;

    RETURN jsonb_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'old_unit_cost', v_old_unit_cost,
        'new_unit_cost', v_new_unit_cost,
        'added_qty', p_qty,
        'current_stock_before', v_current_stock,
        'warehouse_before', v_warehouse,
        'counter_before', v_counter
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
