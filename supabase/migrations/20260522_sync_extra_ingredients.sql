-- Fix: sync extra_ingredients when ingredient key changes or is deleted.
--
-- Problem: sync_ingredient_key RPC and deleteIngredientCost never touched
-- extra_ingredients, so extra options kept stale ingredient references.
--
-- Fix 1: update sync_ingredient_key to also rename in extra_ingredients.
-- Fix 2: create delete_ingredient_cost RPC that cleans extra_ingredients too.

-- ============================================================
-- Fix 1: patch sync_ingredient_key to include extra_ingredients
-- ============================================================
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
    v_recipe_count        INT := 0;
    v_closing_count       INT := 0;
    v_expense_count       INT := 0;
    v_extra_count         INT := 0;
    v_cost_action         TEXT := 'none';
    v_new_exists          BOOLEAN;
    v_old_exists          BOOLEAN;
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
            'recipes_updated', 0, 'closings_updated', 0,
            'expenses_updated', 0, 'extras_updated', 0,
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

    -- 2. recipes — rename
    UPDATE recipes SET ingredient = p_new_key
    WHERE address_id = p_address_id AND ingredient = p_old_key;
    GET DIAGNOSTICS v_recipe_count = ROW_COUNT;

    -- 3. shift_closings.inventory_report (JSONB)
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

    -- 4. expenses.metadata->>'ingredient' (refills + adjustments)
    UPDATE expenses
    SET metadata = jsonb_set(metadata, '{ingredient}', to_jsonb(p_new_key))
    WHERE address_id = p_address_id
      AND metadata IS NOT NULL
      AND metadata->>'ingredient' = p_old_key;
    GET DIAGNOSTICS v_expense_count = ROW_COUNT;

    -- 5. extra_ingredients — rename ingredient key
    --    Join through product_extras to scope by address_id
    UPDATE extra_ingredients ei
    SET ingredient = p_new_key
    FROM product_extras pe
    WHERE ei.extra_id = pe.id
      AND pe.address_id = p_address_id
      AND ei.ingredient = p_old_key;
    GET DIAGNOSTICS v_extra_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'recipes_updated',  v_recipe_count,
        'closings_updated', v_closing_count,
        'expenses_updated', v_expense_count,
        'extras_updated',   v_extra_count,
        'costs_action',     v_cost_action
    );
END;
$$;

GRANT EXECUTE ON FUNCTION sync_ingredient_key(UUID, TEXT, TEXT) TO authenticated;


-- ============================================================
-- Fix 2: RPC to delete ingredient + clean up all references
-- ============================================================
-- Replaces the client-side deleteIngredientCost which only touched
-- ingredient_costs and left orphan rows everywhere.
CREATE OR REPLACE FUNCTION delete_ingredient(
    p_address_id UUID,
    p_ingredient TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_recipe_count  INT := 0;
    v_extra_count   INT := 0;
BEGIN
    IF p_address_id IS NULL OR p_ingredient IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_ingredient are required';
    END IF;

    -- 1. Remove from ingredient_costs (address-specific row)
    DELETE FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    -- 2. Remove from recipes
    DELETE FROM recipes
    WHERE address_id = p_address_id AND ingredient = p_ingredient;
    GET DIAGNOSTICS v_recipe_count = ROW_COUNT;

    -- 3. Remove from extra_ingredients (scoped via product_extras.address_id)
    DELETE FROM extra_ingredients ei
    USING product_extras pe
    WHERE ei.extra_id = pe.id
      AND pe.address_id = p_address_id
      AND ei.ingredient = p_ingredient;
    GET DIAGNOSTICS v_extra_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'recipes_deleted', v_recipe_count,
        'extras_deleted',  v_extra_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION delete_ingredient(UUID, TEXT) TO authenticated;
