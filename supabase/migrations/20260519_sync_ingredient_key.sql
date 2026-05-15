-- Sync ingredient key across ALL tables that reference ingredient names.
-- Replaces the missing `rename_ingredient` RPC (which orderService.js was calling but never existed).
--
-- Tables/columns updated for (address_id, old_key) → new_key:
--   1. ingredient_costs.ingredient   (rename, or merge if new_key already exists)
--   2. recipes.ingredient            (rename all rows)
--   3. shift_closings.inventory_report  (JSONB array — rewrite items where ingredient = old_key)
--   4. expenses.metadata->>'ingredient' (refills + adjustments)
--
-- Mode: always-merge. If both keys exist in ingredient_costs, the new_key row is kept
-- (assumed canonical) and old_key row is deleted — no UNIQUE constraint violations.
--
-- Returns JSONB summary so client can show "3 công thức + 12 chốt ca + 8 chi phí đã đồng bộ".

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

    -- 3. shift_closings.inventory_report (JSONB array of {ingredient, remaining, restock, ...}).
    -- Pre-filter via EXISTS so we only rewrite arrays that actually contain old_key.
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

    -- 4. expenses.metadata->>'ingredient' (refill rows + stock adjustments)
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

GRANT EXECUTE ON FUNCTION sync_ingredient_key(UUID, TEXT, TEXT) TO authenticated;
