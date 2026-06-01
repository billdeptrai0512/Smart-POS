-- ==============================================================================================
-- delete_ingredient: also purge the key from historical shift_closings.inventory_report snapshots.
--
-- Why: the "Nguyên liệu chưa khai báo" warning is derived from every key that appears in any
-- shift_closings.inventory_report JSONB array. Deleting an ingredient previously cleaned
-- ingredient_costs + recipes + extra_ingredients but left old closing snapshots untouched, so the
-- deleted key lingered as an inventory orphan forever. The client now filters those out at read
-- time (ingredientKeySync: inventory orphans only warn when still referenced by a live recipe/
-- extra), but that's a read-side band-aid over dirty data. This migration fixes the data at the
-- SOURCE so the snapshots are actually clean — delete means delete.
--
-- Idempotent: re-running rewrites only rows that still contain the key; rows already clean are
-- skipped by the WHERE guard. Safe to apply repeatedly.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION delete_ingredient(
    p_address_id UUID,
    p_ingredient TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_recipe_count    INT := 0;
    v_extra_count     INT := 0;
    v_snapshot_count  INT := 0;
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

    -- 4. Strip the key from historical inventory_report snapshots. Rebuild each array
    --    without the deleted ingredient's element. Only touch rows that actually contain
    --    it (the EXISTS guard) so we don't churn every closing. COALESCE handles a report
    --    that becomes empty after filtering ('[]'::jsonb, never NULL).
    UPDATE shift_closings sc
    SET inventory_report = COALESCE(
        (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(sc.inventory_report) AS elem
            WHERE (elem->>'ingredient')::TEXT IS DISTINCT FROM p_ingredient
        ),
        '[]'::jsonb
    )
    WHERE sc.address_id = p_address_id
      AND sc.inventory_report IS NOT NULL
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(sc.inventory_report) AS elem
          WHERE (elem->>'ingredient')::TEXT = p_ingredient
      );
    GET DIAGNOSTICS v_snapshot_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'recipes_deleted',   v_recipe_count,
        'extras_deleted',    v_extra_count,
        'snapshots_cleaned', v_snapshot_count
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) TO authenticated;

COMMIT;
