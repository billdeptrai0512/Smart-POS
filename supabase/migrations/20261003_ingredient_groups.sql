-- Nhóm nguyên liệu (danh mục con bên trong 2 tab Nguyên liệu / Bao bì) — mirror expense_categories.
-- section = tab cha ('main' | 'packaging'); ingredient_costs.category vẫn là nguồn của tab, client
-- đặt category theo section khi gán nhóm. group_id NULL = "Chưa phân nhóm".
-- Xoá nhóm = xoá cứng (ON DELETE SET NULL): nhóm không gắn lịch sử nào, khác expense_categories.
CREATE TABLE IF NOT EXISTS public.ingredient_groups (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id  uuid NOT NULL REFERENCES public.addresses(id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (btrim(name) <> ''),
    section     text NOT NULL CHECK (section IN ('main', 'packaging')),
    sort_order  int  NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_groups_unique_name
    ON public.ingredient_groups (address_id, section, lower(name));

ALTER TABLE public.ingredient_costs
    ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.ingredient_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredient_costs_group ON public.ingredient_costs (group_id);

-- RLS: cùng phạm vi với ingredient_costs (costs_read / costs_write). Tách SELECT khỏi phần ghi
-- (không FOR ALL) để tránh multiple_permissive_policies; auth.uid() bọc (SELECT ...) — xem
-- 20260814_fix_performance_advisor_menu_rls.
ALTER TABLE public.ingredient_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ingredient_groups_read" ON public.ingredient_groups;
CREATE POLICY "ingredient_groups_read" ON public.ingredient_groups
    FOR SELECT TO authenticated
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid()))
    );

DROP POLICY IF EXISTS "ingredient_groups_insert" ON public.ingredient_groups;
CREATE POLICY "ingredient_groups_insert" ON public.ingredient_groups
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.is_admin_auth(auth.uid()))
        OR ((SELECT public.is_manager_auth(auth.uid()))
            AND address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid())))
    );

DROP POLICY IF EXISTS "ingredient_groups_update" ON public.ingredient_groups;
CREATE POLICY "ingredient_groups_update" ON public.ingredient_groups
    FOR UPDATE TO authenticated
    USING (  -- không khai WITH CHECK → Postgres dùng lại USING
        (SELECT public.is_admin_auth(auth.uid()))
        OR ((SELECT public.is_manager_auth(auth.uid()))
            AND address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid())))
    );

DROP POLICY IF EXISTS "ingredient_groups_delete" ON public.ingredient_groups;
CREATE POLICY "ingredient_groups_delete" ON public.ingredient_groups
    FOR DELETE TO authenticated
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR ((SELECT public.is_manager_auth(auth.uid()))
            AND address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid())))
    );

REVOKE ALL ON public.ingredient_groups FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_groups TO authenticated;

-- category (tab) và section của nhóm phải luôn khớp — giữ ở DB thay vì trông vào từng chỗ ghi
-- (upsertIngredientCost, import, form tạo mới...):
--   gán/đổi group_id → category theo section của nhóm
--   đổi category mà KHÔNG đổi group_id (chuyển tab) → rời nhóm cũ
CREATE OR REPLACE FUNCTION public.sync_ingredient_group_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_section text;
BEGIN
    IF NEW.group_id IS NULL THEN RETURN NEW; END IF;
    SELECT section INTO v_section FROM ingredient_groups WHERE id = NEW.group_id;
    -- 'tools' (cũ) = bao bì, NULL = nguyên liệu chính — như normalizeIngredientCategory ở client.
    IF v_section IS DISTINCT FROM (CASE WHEN NEW.category IN ('packaging', 'tools') THEN 'packaging' ELSE 'main' END) THEN
        IF TG_OP = 'UPDATE' AND NEW.group_id IS NOT DISTINCT FROM OLD.group_id THEN
            NEW.group_id := NULL;
        ELSE
            NEW.category := v_section;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_ingredient_group_category() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_ingredient_group_category ON public.ingredient_costs;
CREATE TRIGGER trg_sync_ingredient_group_category
BEFORE INSERT OR UPDATE OF group_id, category ON public.ingredient_costs
FOR EACH ROW EXECUTE FUNCTION public.sync_ingredient_group_category();

-- bulk_import_menu v4 = v3 (20261002_bulk_import_menu_replace) + cột "Nhóm" ở sheet Nguyên liệu:
--   ingredients[].group có key → tạo nhóm còn thiếu (so tên không phân biệt hoa/thường, section =
--                       category) rồi gán group_id; '' → bỏ nhóm.
--                       không có key (file không có cột Nhóm / client cũ) → giữ nhóm hiện tại.
-- Phần còn lại giữ nguyên v3 (SECURITY INVOKER — RLS vẫn chặn quyền).
CREATE OR REPLACE FUNCTION public.bulk_import_menu(p_address_id uuid, p_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_min_sort int;
    v_max_sort int;
    v_n int;
    v_expected int;
    v_layout_n int;
BEGIN
    -- Sản phẩm mới: sort_order âm dần từ min hiện có (giống insertProduct — món mới lên đầu).
    SELECT LEAST(0, COALESCE(MIN(sort_order), 0)) INTO v_min_sort
    FROM products
    WHERE owner_address_id IS NOT DISTINCT FROM p_address_id;

    INSERT INTO products (id, name, price, owner_address_id, sort_order)
    SELECT (e->>'id')::uuid, e->>'name', (e->>'price')::numeric, p_address_id, v_min_sort - ord
    FROM jsonb_array_elements(COALESCE(p_plan->'products', '[]')) WITH ORDINALITY t(e, ord);

    -- Danh mục mới (tạm đặt sort_order thấp, khối layout cuối hàm sẽ xếp lại).
    INSERT INTO products (id, name, price, owner_address_id, sort_order, is_divider)
    SELECT (e->>'id')::uuid, e->>'name', 0, p_address_id, v_min_sort - 100000 - ord, true
    FROM jsonb_array_elements(COALESCE(p_plan->'dividers', '[]')) WITH ORDINALITY t(e, ord);

    v_expected := jsonb_array_length(COALESCE(p_plan->'productUpdates', '[]'));
    UPDATE products p SET price = (e->>'price')::numeric
    FROM jsonb_array_elements(COALESCE(p_plan->'productUpdates', '[]')) e
    WHERE p.id = (e->>'id')::uuid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_expected THEN
        RAISE EXCEPTION 'Không có quyền sửa giá một số món (bị chặn bởi RLS hoặc món không tồn tại)';
    END IF;

    -- Nguyên liệu (mới + cập nhật): upsert theo (ingredient, address_id) như upsertIngredientCost.
    INSERT INTO ingredient_costs (ingredient, unit_cost, unit, address_id, category)
    SELECT e->>'key', (e->>'unitCost')::numeric, NULLIF(e->>'unit', ''), p_address_id, e->>'category'
    FROM jsonb_array_elements(COALESCE(p_plan->'ingredients', '[]')) e
    ON CONFLICT (ingredient, address_id) DO UPDATE
        SET unit_cost = EXCLUDED.unit_cost,
            unit = COALESCE(EXCLUDED.unit, ingredient_costs.unit),
            category = EXCLUDED.category;

    -- Nhóm nguyên liệu: tạo nhóm mới theo thứ tự xuất hiện trong file, nối sau sort_order lớn nhất.
    INSERT INTO ingredient_groups (address_id, name, section, sort_order)
    SELECT p_address_id, g.name, g.section,
           COALESCE((SELECT MAX(ig.sort_order) FROM ingredient_groups ig
                     WHERE ig.address_id = p_address_id AND ig.section = g.section), 0)
           + ROW_NUMBER() OVER (PARTITION BY g.section ORDER BY g.ord)
    FROM (
        SELECT DISTINCT ON (COALESCE(e->>'category', 'main'), lower(btrim(e->>'group')))
               btrim(e->>'group') AS name, COALESCE(e->>'category', 'main') AS section, ord
        FROM jsonb_array_elements(COALESCE(p_plan->'ingredients', '[]')) WITH ORDINALITY t(e, ord)
        WHERE btrim(COALESCE(e->>'group', '')) <> ''
        ORDER BY COALESCE(e->>'category', 'main'), lower(btrim(e->>'group')), ord
    ) g
    WHERE NOT EXISTS (
        SELECT 1 FROM ingredient_groups ig
        WHERE ig.address_id = p_address_id AND ig.section = g.section AND lower(ig.name) = lower(g.name)
    );

    UPDATE ingredient_costs ic
    SET group_id = x.gid
    FROM (
        SELECT e->>'key' AS key, ig.id AS gid
        FROM jsonb_array_elements(COALESCE(p_plan->'ingredients', '[]')) e
        LEFT JOIN ingredient_groups ig
               ON ig.address_id = p_address_id
              AND ig.section = COALESCE(e->>'category', 'main')
              AND lower(ig.name) = lower(btrim(e->>'group'))
        WHERE e ? 'group'
    ) x
    WHERE ic.address_id = p_address_id
      AND ic.ingredient = x.key
      AND ic.group_id IS DISTINCT FROM x.gid;

    -- Topping mới: mỗi topping có 1 dòng nguyên liệu cùng tên (giá vốn 0) như insertTopping.
    -- DO NOTHING (bản cũ ghi đè về 0) để không xoá giá vốn đã có / vừa nhập ở sheet Nguyên liệu.
    INSERT INTO ingredient_costs (ingredient, unit_cost, unit, address_id)
    SELECT e->>'ingredientKey', 0, COALESCE(NULLIF(e->>'unit', ''), 'đv'), p_address_id
    FROM jsonb_array_elements(COALESCE(p_plan->'toppings', '[]')) e
    ON CONFLICT (ingredient, address_id) DO NOTHING;

    SELECT COALESCE(MAX(sort_order), -1) INTO v_max_sort
    FROM toppings
    WHERE address_id IS NOT DISTINCT FROM p_address_id;

    INSERT INTO toppings (id, name, price, address_id, sort_order)
    SELECT (e->>'id')::uuid, e->>'name', (e->>'price')::numeric, p_address_id, v_max_sort + ord
    FROM jsonb_array_elements(COALESCE(p_plan->'toppings', '[]')) WITH ORDINALITY t(e, ord);

    v_expected := jsonb_array_length(COALESCE(p_plan->'toppingUpdates', '[]'));
    UPDATE toppings t SET price = (e->>'price')::numeric
    FROM jsonb_array_elements(COALESCE(p_plan->'toppingUpdates', '[]')) e
    WHERE t.id = (e->>'id')::uuid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_expected THEN
        RAISE EXCEPTION 'Không có quyền sửa giá một số topping (bị chặn bởi RLS hoặc topping không tồn tại)';
    END IF;

    -- Tùy chọn thêm mới: sort_order = max + 1 theo từng món (giống insertProductExtra).
    INSERT INTO product_extras (id, product_id, name, price, address_id, is_sticky, sort_order)
    SELECT x.id, x.product_id, x.name, x.price, p_address_id, x.sticky,
           COALESCE((SELECT MAX(pe.sort_order) FROM product_extras pe
                     WHERE pe.product_id = x.product_id AND pe.address_id IS NOT DISTINCT FROM p_address_id), -1)
           + ROW_NUMBER() OVER (PARTITION BY x.product_id ORDER BY x.ord)
    FROM (
        SELECT (e->>'id')::uuid AS id, (e->>'productId')::uuid AS product_id, e->>'name' AS name,
               (e->>'price')::numeric AS price, COALESCE((e->>'sticky')::boolean, false) AS sticky, ord
        FROM jsonb_array_elements(COALESCE(p_plan->'extras', '[]')) WITH ORDINALITY t(e, ord)
    ) x;

    v_expected := jsonb_array_length(COALESCE(p_plan->'extraUpdates', '[]'));
    UPDATE product_extras pe
    SET price = (e->>'price')::numeric, is_sticky = COALESCE((e->>'sticky')::boolean, false)
    FROM jsonb_array_elements(COALESCE(p_plan->'extraUpdates', '[]')) e
    WHERE pe.id = (e->>'id')::uuid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_expected THEN
        RAISE EXCEPTION 'Không có quyền sửa một số tùy chọn thêm (bị chặn bởi RLS hoặc không tồn tại)';
    END IF;

    -- Công thức món / topping / tùy chọn: upsert theo cùng khoá với các hàm service cũ.
    -- DISTINCT ON: file Excel có thể lặp 1 cặp → ON CONFLICT không được đụng 1 dòng 2 lần
    -- (giữ dòng cuối, khớp hành vi ghi tuần tự trước đây).
    INSERT INTO recipes (product_id, ingredient, amount, unit, address_id)
    SELECT DISTINCT ON (pid, e->>'ingredient')
           pid, e->>'ingredient', (e->>'amount')::numeric, NULLIF(e->>'unit', ''), p_address_id
    FROM (SELECT e, (e->>'productId')::uuid AS pid, ord
          FROM jsonb_array_elements(COALESCE(p_plan->'recipes', '[]')) WITH ORDINALITY t(e, ord)) s
    ORDER BY pid, e->>'ingredient', ord DESC
    ON CONFLICT (product_id, ingredient, address_id) DO UPDATE
        SET amount = EXCLUDED.amount, unit = COALESCE(EXCLUDED.unit, recipes.unit);

    INSERT INTO topping_ingredients (topping_id, ingredient, amount, unit)
    SELECT DISTINCT ON (tid, e->>'ingredient')
           tid, e->>'ingredient', (e->>'amount')::numeric, NULLIF(e->>'unit', '')
    FROM (SELECT e, (e->>'toppingId')::uuid AS tid, ord
          FROM jsonb_array_elements(COALESCE(p_plan->'toppingIngredients', '[]')) WITH ORDINALITY t(e, ord)) s
    ORDER BY tid, e->>'ingredient', ord DESC
    ON CONFLICT (topping_id, ingredient) DO UPDATE
        SET amount = EXCLUDED.amount, unit = COALESCE(EXCLUDED.unit, topping_ingredients.unit);

    INSERT INTO extra_ingredients (extra_id, ingredient, amount, unit)
    SELECT DISTINCT ON (xid, e->>'ingredient')
           xid, e->>'ingredient', (e->>'amount')::numeric, NULLIF(e->>'unit', '')
    FROM (SELECT e, (e->>'extraId')::uuid AS xid, ord
          FROM jsonb_array_elements(COALESCE(p_plan->'extraIngredients', '[]')) WITH ORDINALITY t(e, ord)) s
    ORDER BY xid, e->>'ingredient', ord DESC
    ON CONFLICT (extra_id, ingredient) DO UPDATE
        SET amount = EXCLUDED.amount, unit = COALESCE(EXCLUDED.unit, extra_ingredients.unit);

    -- ── Ghi đè: xoá phần không có trong file (chỉ với sheet có mặt) ─────────────────────────
    IF COALESCE((p_plan#>>'{replace,products}')::boolean, false) THEN
        UPDATE products SET is_active = false
        WHERE owner_address_id IS NOT DISTINCT FROM p_address_id
          AND is_active
          -- layout luôn được gửi khi ghi đè Sản phẩm và chứa đủ mọi món + danh mục trong file.
          AND id NOT IN (SELECT x::uuid FROM jsonb_array_elements_text(COALESCE(p_plan->'layout', '[]')) x);
    END IF;

    IF COALESCE((p_plan#>>'{replace,toppings}')::boolean, false) THEN
        DELETE FROM toppings
        WHERE address_id IS NOT DISTINCT FROM p_address_id
          AND id NOT IN (
              SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_plan->'toppings', '[]')) e
              UNION SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_plan->'toppingUpdates', '[]')) e
          );
    END IF;

    IF COALESCE((p_plan#>>'{replace,extras}')::boolean, false) THEN
        DELETE FROM product_extras
        WHERE address_id IS NOT DISTINCT FROM p_address_id
          AND id NOT IN (
              SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_plan->'extras', '[]')) e
              UNION SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(p_plan->'extraUpdates', '[]')) e
          );
    END IF;

    IF COALESCE((p_plan#>>'{replace,recipes}')::boolean, false) THEN
        DELETE FROM recipes r
        WHERE r.address_id IS NOT DISTINCT FROM p_address_id
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(p_plan->'recipes', '[]')) e
              WHERE (e->>'productId')::uuid = r.product_id AND e->>'ingredient' = r.ingredient
          );
    END IF;

    IF COALESCE((p_plan#>>'{replace,toppingIngredients}')::boolean, false) THEN
        DELETE FROM topping_ingredients ti
        USING toppings t
        WHERE ti.topping_id = t.id
          AND t.address_id IS NOT DISTINCT FROM p_address_id
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(p_plan->'toppingIngredients', '[]')) e
              WHERE (e->>'toppingId')::uuid = ti.topping_id AND e->>'ingredient' = ti.ingredient
          );
    END IF;

    IF COALESCE((p_plan#>>'{replace,extraIngredients}')::boolean, false) THEN
        DELETE FROM extra_ingredients ei
        USING product_extras pe
        WHERE ei.extra_id = pe.id
          AND pe.address_id IS NOT DISTINCT FROM p_address_id
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(p_plan->'extraIngredients', '[]')) e
              WHERE (e->>'extraId')::uuid = ei.extra_id AND e->>'ingredient' = ei.ingredient
          );
    END IF;

    -- Topping áp dụng món: ghi đè → xoá mọi liên kết của địa chỉ; không → chỉ topping có trong file.
    DELETE FROM product_toppings pt
    USING toppings t
    WHERE pt.topping_id = t.id
      AND t.address_id IS NOT DISTINCT FROM p_address_id
      AND (
          COALESCE((p_plan#>>'{replace,toppingLinks}')::boolean, false)
          OR t.id IN (SELECT (e->>'toppingId')::uuid FROM jsonb_array_elements(COALESCE(p_plan->'toppingLinks', '[]')) e)
      );

    INSERT INTO product_toppings (product_id, topping_id)
    SELECT DISTINCT pid::uuid, (e->>'toppingId')::uuid
    FROM jsonb_array_elements(COALESCE(p_plan->'toppingLinks', '[]')) e,
         jsonb_array_elements_text(e->'productIds') pid;

    -- Xếp thứ tự: cả khối layout nằm trước mọi món ngoài file, giữ đúng thứ tự trong file.
    v_layout_n := jsonb_array_length(COALESCE(p_plan->'layout', '[]'));
    IF v_layout_n > 0 THEN
        SELECT LEAST(0, COALESCE(MIN(sort_order), 0)) INTO v_min_sort
        FROM products
        WHERE owner_address_id IS NOT DISTINCT FROM p_address_id
          AND id NOT IN (SELECT x::uuid FROM jsonb_array_elements_text(p_plan->'layout') x);

        UPDATE products p SET sort_order = v_min_sort - (v_layout_n + 1 - t.ord)
        FROM jsonb_array_elements_text(p_plan->'layout') WITH ORDINALITY t(x, ord)
        WHERE p.id = t.x::uuid;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> v_layout_n THEN
            RAISE EXCEPTION 'Không xếp được thứ tự menu (bị chặn bởi RLS hoặc món không tồn tại)';
        END IF;
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_import_menu(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_import_menu(uuid, jsonb) TO authenticated;
