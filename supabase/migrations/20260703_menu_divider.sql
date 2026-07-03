-- Divider ("mục") phân nhóm menu: sống ngay trong bảng products để dùng chung
-- sort_order per-address + RPC update_products_sort_order + RLS sẵn có.
-- is_divider = true → không phải món bán, chỉ là dòng tiêu đề ----{name}----
-- hiển thị trên /pos và /recipes. Không đụng function nào → không cần guard
-- search_path / ownership (xem CLAUDE.md).
alter table public.products
    add column if not exists is_divider boolean not null default false;

-- ── get_shared_config: mang is_divider theo snapshot share-code ────────────────
-- Không có dòng này, clone xuyên tài khoản biến divider thành "món 0đ".
-- Re-create theo rule CLAUDE.md: giữ SET search_path, giữ cơ chế guard gốc
-- (share code = chìa khóa, RLS bypass có chủ đích qua SECURITY DEFINER),
-- restate REVOKE/GRANT. Chỉ khác bản 20260620: thêm 'is_divider' vào products.
CREATE OR REPLACE FUNCTION public.get_shared_config(p_code TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'source_address_id', sc.source_address_id,
        'products', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'price', p.price,
            'sort_order', p.sort_order, 'count_as_cup', p.count_as_cup,
            'is_divider', p.is_divider))
            FROM products p WHERE p.owner_address_id = sc.source_address_id AND p.is_active), '[]'::jsonb),
        'recipes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'product_id', r.product_id, 'ingredient', r.ingredient,
            'amount', r.amount, 'unit', r.unit))
            FROM recipes r WHERE r.address_id = sc.source_address_id), '[]'::jsonb),
        'extras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', e.id, 'product_id', e.product_id, 'name', e.name,
            'price', e.price, 'sort_order', e.sort_order, 'is_sticky', e.is_sticky))
            FROM product_extras e WHERE e.address_id = sc.source_address_id), '[]'::jsonb),
        'extra_ingredients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'extra_id', ei.extra_id, 'ingredient', ei.ingredient,
            'amount', ei.amount, 'unit', ei.unit))
            FROM extra_ingredients ei
            WHERE ei.extra_id IN (SELECT id FROM product_extras WHERE address_id = sc.source_address_id)), '[]'::jsonb),
        'costs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'ingredient', c.ingredient, 'unit_cost', c.unit_cost, 'unit', c.unit))
            FROM ingredient_costs c WHERE c.address_id = sc.source_address_id), '[]'::jsonb),
        'ingredient_sort_order',
            COALESCE((SELECT ingredient_sort_order FROM addresses WHERE id = sc.source_address_id), '[]'::jsonb)
    )
    FROM address_share_codes sc
    WHERE sc.code = upper(trim(p_code))
      AND sc.expires_at > now();
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_config(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_shared_config(TEXT) TO authenticated;

-- ⚠️ Còn lại NGOÀI repo: hàm clone_default_menu (trigger seed menu mặc định cho
-- địa chỉ MỚI) được tạo trước đợt migrations này, không có source ở đây nên không
-- sửa mù được. Nếu admin thêm divider vào "Mẫu mặc định", cần bổ sung is_divider
-- vào INSERT...SELECT của hàm đó (dashboard), không thì divider của mẫu sẽ clone
-- thành món 0đ ở địa chỉ mới. Divider tạo per-address không bị ảnh hưởng.
