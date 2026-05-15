-- ==============================================================================================
-- 20260520_security_hardening.sql
-- Description: Address remaining Supabase Security Advisor warnings.
--
-- 1. anon_security_definer_function_executable on sync_ingredient_key:
--    Migration 20260519 only GRANTed to authenticated without REVOKE FROM PUBLIC first, so
--    PostgreSQL's default still allows anon role to call it via /rest/v1/rpc.
--    → REVOKE from PUBLIC/anon, keep authenticated grant.
--
-- 2. Missing ownership guards on SECURITY DEFINER write RPCs:
--    Both sync_ingredient_key and process_ingredient_restock currently accept any p_address_id
--    without verifying the caller has write access to that address. Authenticated user A could
--    pass shop B's address_id and mutate B's data.
--    → Add guard mirroring the addresses RLS policy (admin OR direct manager OR co-manager via
--      user_address_access). The guard skips when auth.uid() IS NULL so service_role / migrations
--      can still call the function unchanged.
--    → sync_ingredient_key gets an additional is_manager_auth check (rename is manager-only;
--      staff doing operational work like restock don't rename ingredients).
--
-- 3. function_search_path_mutable on 4 functions:
--    Re-apply SET search_path = public via ALTER FUNCTION (idempotent, no behavior change).
--    Some were set in earlier migrations but later CREATE OR REPLACE calls dropped the setting.
--
-- Note: CREATE OR REPLACE FUNCTION preserves GRANTs but DROPS function-level settings
-- (SET search_path), so we re-declare them inline. REVOKE/GRANT are explicit for clarity.
-- ==============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. sync_ingredient_key — REVOKE anon + add manager ownership guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_ingredient_key(
    p_address_id UUID,
    p_old_key TEXT,
    p_new_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_recipe_count   INT := 0;
    v_closing_count  INT := 0;
    v_expense_count  INT := 0;
    v_cost_action    TEXT := 'none';
    v_new_exists     BOOLEAN;
    v_old_exists     BOOLEAN;
BEGIN
    -- Guards
    IF p_address_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id cannot be NULL';
    END IF;
    IF p_old_key IS NULL OR p_new_key IS NULL THEN
        RAISE EXCEPTION 'Keys cannot be NULL';
    END IF;
    IF length(trim(p_old_key)) = 0 OR length(trim(p_new_key)) = 0 THEN
        RAISE EXCEPTION 'Keys cannot be empty';
    END IF;
    IF p_old_key = p_new_key THEN
        RETURN jsonb_build_object(
            'recipes_updated', 0, 'closings_updated', 0, 'expenses_updated', 0,
            'costs_action', 'noop'
        );
    END IF;

    -- Ownership guard: manager-only action. Skip when auth.uid() IS NULL
    -- (service_role / migrations bypass, mirroring RLS behavior).
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can rename ingredients' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT EXISTS (
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
    END IF;

    -- 1. ingredient_costs — merge or rename
    SELECT EXISTS(SELECT 1 FROM ingredient_costs
                  WHERE address_id = p_address_id AND ingredient = p_new_key)
        INTO v_new_exists;
    SELECT EXISTS(SELECT 1 FROM ingredient_costs
                  WHERE address_id = p_address_id AND ingredient = p_old_key)
        INTO v_old_exists;

    IF v_old_exists AND v_new_exists THEN
        DELETE FROM ingredient_costs
        WHERE address_id = p_address_id AND ingredient = p_old_key;
        v_cost_action := 'merged';
    ELSIF v_old_exists AND NOT v_new_exists THEN
        UPDATE ingredient_costs SET ingredient = p_new_key
        WHERE address_id = p_address_id AND ingredient = p_old_key;
        v_cost_action := 'renamed';
    END IF;

    -- 2. recipes — straightforward rename
    UPDATE recipes SET ingredient = p_new_key
    WHERE address_id = p_address_id AND ingredient = p_old_key;
    GET DIAGNOSTICS v_recipe_count = ROW_COUNT;

    -- 3. shift_closings.inventory_report (JSONB array)
    UPDATE shift_closings sc
    SET inventory_report = (
        SELECT jsonb_agg(
            CASE WHEN elem->>'ingredient' = p_old_key
                THEN jsonb_set(elem, '{ingredient}', to_jsonb(p_new_key))
                ELSE elem
            END
        )
        FROM jsonb_array_elements(sc.inventory_report) AS elem
    )
    WHERE sc.address_id = p_address_id
      AND sc.inventory_report IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(sc.inventory_report) AS e
          WHERE e->>'ingredient' = p_old_key
      );
    GET DIAGNOSTICS v_closing_count = ROW_COUNT;

    -- 4. expenses.metadata->>'ingredient'
    UPDATE expenses
    SET metadata = jsonb_set(metadata, '{ingredient}', to_jsonb(p_new_key))
    WHERE address_id = p_address_id
      AND metadata IS NOT NULL
      AND metadata->>'ingredient' = p_old_key;
    GET DIAGNOSTICS v_expense_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'recipes_updated',  v_recipe_count,
        'closings_updated', v_closing_count,
        'expenses_updated', v_expense_count,
        'costs_action',     v_cost_action
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_ingredient_key(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_ingredient_key(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.sync_ingredient_key(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. process_ingredient_restock — add address-access ownership guard
--    (staff can restock as part of operations, so we don't require manager role)
-- ---------------------------------------------------------------------------
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
    v_current_stock NUMERIC;
    v_old_unit_cost NUMERIC;
    v_new_unit_cost NUMERIC;
    v_expense_id UUID;
    v_display_name TEXT;
BEGIN
    -- Ownership guard. Allows admin / direct manager / co-manager via user_address_access.
    -- Skip when auth.uid() IS NULL (service_role / migrations bypass).
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

    -- 1. Read current stock from latest shift_closings
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

    IF v_current_stock IS NULL THEN v_current_stock := 0; END IF;
    IF v_current_stock < 0 THEN v_current_stock := 0; END IF;

    -- 2. Get current unit cost
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. Weighted average new unit cost
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + p_total_cost) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    -- 4. Update unit cost
    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    -- 5. Display name
    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

    -- 6. Insert expense (cash outflow)
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
        'current_stock_before', v_current_stock
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Re-apply SET search_path = public on functions flagged by linter.
--    Pure hardening — no behavior change. Idempotent.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_report_by_date(uuid, date)         SET search_path = public;
ALTER FUNCTION public.get_daily_report_context(uuid)         SET search_path = public;
ALTER FUNCTION public.get_report_by_range(uuid, timestamptz, timestamptz, timestamptz, timestamptz) SET search_path = public;
ALTER FUNCTION public.get_address_entitlement(uuid)          SET search_path = public;

COMMIT;
