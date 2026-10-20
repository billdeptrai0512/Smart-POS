-- ==============================================================================================
-- 20261030_topping_source_follow_ingredient.sql
-- Description: nguồn tồn kho của topping (toppings.source_ingredient, 20261028) phải đi theo nguyên liệu:
--   * sync_ingredient_key (đổi tên / gộp nguyên liệu hoặc thành phẩm) → cập nhật source_ingredient.
--   * delete_ingredient → bỏ nguồn (source_* = NULL) để topping quay về công thức, thay vì treo trỏ vào khoá đã xoá.
-- Thân 2 hàm = NGUYÊN VĂN 20260601 / 20260930, chỉ thêm 1 câu UPDATE toppings. CÙNG signature → search_path +
-- ownership guard giữ nguyên, REVOKE/GRANT re-declare. Cần 20261028 đã chạy.
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

    -- 3b. Topping đang lấy tồn từ nguyên liệu này (toppings.source_*): bỏ nguồn → topping quay về tính theo
    --     topping_ingredients. Để nguồn treo thì tiêu hao/giá vốn của topping lặng lẽ về 0.
    UPDATE toppings SET source_ingredient = NULL, source_amount = NULL
    WHERE address_id = p_address_id AND source_ingredient = p_ingredient;

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


REVOKE EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_ingredient(UUID, TEXT) TO authenticated;

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

    -- 2. recipes — rename, nhưng món nào đã có sẵn dòng new_key thì bỏ dòng old_key trước
    --    (nếu không vi phạm idx_recipes_product_ingredient_address, cùng cách xử lý extras bước 5).
    DELETE FROM recipes r
    WHERE r.address_id = p_address_id
      AND r.ingredient = p_old_key
      AND EXISTS (
          SELECT 1 FROM recipes r2
          WHERE r2.product_id = r.product_id AND r2.address_id = r.address_id
            AND r2.ingredient = p_new_key
      );

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

    -- 6. toppings.source_ingredient — đổi theo (không có ràng buộc unique nên rename thẳng).
    UPDATE toppings SET source_ingredient = p_new_key
    WHERE address_id = p_address_id AND source_ingredient = p_old_key;

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

COMMIT;
