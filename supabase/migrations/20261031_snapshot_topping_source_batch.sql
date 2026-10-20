-- ==============================================================================================
-- 20261031_snapshot_topping_source_batch.sql
-- Description: snapshot cấu hình địa chỉ (nhân bản chi nhánh + sao lưu) còn thiếu 2 thứ của tính năng thành phẩm / nguồn topping:
--   * products.is_batch + batch_yield  → thành phẩm không bị chép thành món thường.
--   * toppings.source_ingredient + source_amount → topping giữ nguồn tồn kho.
-- Thân hàm = NGUYÊN VĂN 20261010, chỉ thêm các khoá trên. Hàm NỘI BỘ (get_shared_config / get_address_config gọi) →
-- REVOKE cả authenticated, đã nằm trong INTERNAL_ONLY của scripts/check-search-path.mjs. Cần 20261028 + 20261026/27 đã chạy.
-- Client (backupService) chép row theo snapshot nên toppings tự mang cột mới; products được ghi theo danh sách cột tường minh
-- → đã thêm is_batch / batch_yield ở đó.
-- ==============================================================================================
BEGIN;

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
            'is_divider', p.is_divider,
            'is_batch', p.is_batch, 'batch_yield', p.batch_yield))
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
            'id', t.id, 'name', t.name, 'price', t.price, 'sort_order', t.sort_order,
            'source_ingredient', t.source_ingredient, 'source_amount', t.source_amount))
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

COMMIT;
