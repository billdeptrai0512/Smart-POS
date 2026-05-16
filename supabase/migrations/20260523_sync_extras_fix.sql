-- ==============================================================================================
-- 20260523_sync_extras_fix.sql
-- Follow-up to 20260522_sync_extra_ingredients.sql.
--
-- 20260522 re-created sync_ingredient_key without the ownership guards that 20260520 had added,
-- and introduced delete_ingredient with no guard at all. Both let any authenticated user pass
-- another tenant's address_id and mutate that tenant's data — same cross-tenant attack vector
-- that 20260520 was written to close.
--
-- This migration:
--   1. Re-applies the manager-only + address-ownership guard to sync_ingredient_key.
--   2. Adds the same address-ownership guard to delete_ingredient (managers + staff via
--      user_address_access — deletion is destructive but staff CAN already trigger it via the
--      ingredient page; we mirror process_ingredient_restock's policy, not the manager-only one).
--   3. Fixes a UNIQUE (extra_id, ingredient) collision risk in the extras rename:
--      if an extra already has both p_old_key and p_new_key, the blind UPDATE in 20260522 violates
--      the unique constraint and aborts the whole sync transaction. We delete the old-key row
--      where new-key already exists for the same extra, then rename the rest.
-- ==============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. sync_ingredient_key — restore guards + safe extras rename
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
    v_extra_count    INT := 0;
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
            'recipes_updated', 0, 'closings_updated', 0,
            'expenses_updated', 0, 'extras_updated', 0,
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

    -- 4. expenses.metadata->>'ingredient'
    UPDATE expenses
    SET metadata = jsonb_set(metadata, '{ingredient}', to_jsonb(p_new_key))
    WHERE address_id = p_address_id
      AND metadata IS NOT NULL
      AND metadata->>'ingredient' = p_old_key;
    GET DIAGNOSTICS v_expense_count = ROW_COUNT;

    -- 5. extra_ingredients — rename, but first drop old-key rows for extras that
    --    already contain new_key (would violate UNIQUE (extra_id, ingredient)).
    --    Equivalent to the merge-or-rename pattern used for ingredient_costs.
    DELETE FROM extra_ingredients ei
    USING product_extras pe
    WHERE ei.extra_id = pe.id
      AND pe.address_id = p_address_id
      AND ei.ingredient = p_old_key
      AND EXISTS (
          SELECT 1 FROM extra_ingredients ei2
          WHERE ei2.extra_id = ei.extra_id AND ei2.ingredient = p_new_key
      );

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

REVOKE EXECUTE ON FUNCTION public.sync_ingredient_key(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_ingredient_key(UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.sync_ingredient_key(UUID, TEXT, TEXT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2. delete_ingredient — add address-ownership guard
-- ---------------------------------------------------------------------------
-- Same scope as process_ingredient_restock: any user with write access to the
-- address (admin / direct manager / co-manager via user_address_access) can call.
-- Staff already trigger ingredient deletion through the management UI today.
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

    -- Ownership guard. Skip when auth.uid() IS NULL (service_role / migrations bypass).
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

    -- 1. Remove from ingredient_costs (address-specific row only — keep global default)
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

REVOKE EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) TO authenticated;

COMMIT;
