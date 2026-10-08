-- Nhân bản chi nhánh chép ĐỦ cấu hình: thêm nhóm nguyên liệu (ingredient_groups + group_id), toàn bộ
-- cột ingredient_costs (category, quy cách, tồn tối thiểu, bì...), topping (+ công thức + áp dụng món)
-- chương trình giảm giá (+ món áp dụng) và danh mục chi phí. Trước đây snapshot chỉ mang ingredient/unit_cost/unit nên
-- chi nhánh mới mất phân loại danh mục nguyên liệu.
--
-- 1 nguồn snapshot duy nhất cho cả 2 đường clone (cùng tài khoản + share-code) để khỏi lệch nhau:
--   address_config_snapshot(uuid)  — nội bộ, dựng JSON. ingredient_costs / discount_programs dùng
--                                    to_jsonb(row) trừ id/address_id nên cột thêm sau này tự được chép.
--   get_shared_config(code)        — như cũ (cross-account, authorize bằng share code) + snapshot mới.
--   get_address_config(uuid)       — MỚI, cùng tài khoản; ownership guard như create_address_share_code.
-- Không chép: addresses.tables / dine_in / IP máy in (cố ý — xem 20260808_address_tables.sql).

CREATE OR REPLACE FUNCTION public.address_config_snapshot(p_address_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'source_address_id', p_address_id,
        'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'price', p.price,
            'sort_order', p.sort_order, 'count_as_cup', p.count_as_cup,
            'is_divider', p.is_divider))
            FROM products p WHERE p.owner_address_id = p_address_id AND p.is_active), '[]'::jsonb),
        'recipes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'product_id', r.product_id, 'ingredient', r.ingredient,
            'amount', r.amount, 'unit', r.unit))
            FROM recipes r WHERE r.address_id = p_address_id), '[]'::jsonb),
        'extras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', e.id, 'product_id', e.product_id, 'name', e.name,
            'price', e.price, 'sort_order', e.sort_order, 'is_sticky', e.is_sticky))
            FROM product_extras e WHERE e.address_id = p_address_id), '[]'::jsonb),
        'extra_ingredients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'extra_id', ei.extra_id, 'ingredient', ei.ingredient,
            'amount', ei.amount, 'unit', ei.unit))
            FROM extra_ingredients ei
            WHERE ei.extra_id IN (SELECT id FROM product_extras WHERE address_id = p_address_id)), '[]'::jsonb),
        'costs', COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'id' - 'address_id' - 'created_at')
            FROM ingredient_costs c WHERE c.address_id = p_address_id), '[]'::jsonb),
        'ingredient_groups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', g.id, 'name', g.name, 'section', g.section, 'sort_order', g.sort_order))
            FROM ingredient_groups g WHERE g.address_id = p_address_id), '[]'::jsonb),
        'ingredient_sort_order',
            COALESCE((SELECT ingredient_sort_order FROM addresses WHERE id = p_address_id), '[]'::jsonb),
        'toppings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.name, 'price', t.price, 'sort_order', t.sort_order))
            FROM toppings t WHERE t.address_id = p_address_id), '[]'::jsonb),
        'topping_ingredients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'topping_id', ti.topping_id, 'ingredient', ti.ingredient,
            'amount', ti.amount, 'unit', ti.unit))
            FROM topping_ingredients ti
            WHERE ti.topping_id IN (SELECT id FROM toppings WHERE address_id = p_address_id)), '[]'::jsonb),
        'product_toppings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'product_id', pt.product_id, 'topping_id', pt.topping_id))
            FROM product_toppings pt
            WHERE pt.topping_id IN (SELECT id FROM toppings WHERE address_id = p_address_id)), '[]'::jsonb),
        'discount_programs', COALESCE((SELECT jsonb_agg(to_jsonb(d) - 'address_id' - 'created_at')
            FROM discount_programs d WHERE d.address_id = p_address_id), '[]'::jsonb),
        -- Chỉ nhãn đang dùng (is_active); không có bảng nào trỏ vào nhãn của địa chỉ mới nên khỏi map id.
        'expense_categories', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'id' - 'address_id' - 'created_at' - 'updated_at')
            FROM expense_categories x WHERE x.address_id = p_address_id AND x.is_active), '[]'::jsonb),
        'discount_program_products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'discount_program_id', dp.discount_program_id, 'product_id', dp.product_id))
            FROM discount_program_products dp
            WHERE dp.discount_program_id IN (SELECT id FROM discount_programs WHERE address_id = p_address_id)), '[]'::jsonb)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.address_config_snapshot(UUID) FROM PUBLIC, anon, authenticated;

-- Cross-account: mã sai/hết hạn → 0 dòng → NULL (client bắt !data → báo lỗi). LANGUAGE sql để thân
-- hàm chỉ có 1 dấu ';' cuối (Supabase SQL editor không cắt nhầm).
CREATE OR REPLACE FUNCTION public.get_shared_config(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.address_config_snapshot(sc.source_address_id)
    FROM address_share_codes sc
    WHERE sc.code = upper(trim(p_code))
      AND sc.expires_at > now();
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_config(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shared_config(TEXT) TO authenticated;

-- Cùng tài khoản: đọc snapshot địa chỉ mình quản lý / được cấp quyền (thay cho 7 SELECT lẻ ở client).
CREATE OR REPLACE FUNCTION public.get_address_config(p_address_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Ownership guard. Skip khi auth.uid() IS NULL (service_role / migration).
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        IF NOT EXISTS (
            SELECT 1 FROM addresses a
             WHERE a.id = p_address_id
               AND (a.manager_id = public.auth_owner_id(auth.uid())
                    OR EXISTS (SELECT 1 FROM user_address_access ua
                                WHERE ua.address_id = a.id AND ua.auth_id = auth.uid()))
        ) THEN
            RAISE EXCEPTION 'Không có quyền với chi nhánh này'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    RETURN public.address_config_snapshot(p_address_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_address_config(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_address_config(UUID) TO authenticated;
