-- ==============================================================================================
-- 20260814_fix_performance_advisor_menu_rls.sql
-- Description: gỡ auth.uid() khỏi vòng lặp per-row cho 15 policy, và cắt extra_ings_write khỏi
--              đường SELECT.
--
-- VẤN ĐỀ — auth_rls_initplan (0003). Policy viết `public.is_admin_auth(auth.uid())` thì Postgres
-- gọi lại CHO TỪNG DÒNG. STABLE không cứu: chỉ IMMUTABLE mới được constant-fold, STABLE chỉ hứa
-- "không đổi trong một câu lệnh" nên planner vẫn phải gọi. Bọc trong `(SELECT ...)` biến nó thành
-- InitPlan — chạy MỘT lần cho cả câu.
--
-- Đổi được mà không đổi ngữ nghĩa vì mấy biểu thức đó KHÔNG tham chiếu cột nào của dòng đang xét.
-- Phần EXISTS(...) có tham chiếu (extra_ingredients.extra_id) thì GIỮ NGUYÊN per-row.
--
-- HAI TẦNG, vì hai nhóm policy đắt khác nhau hẳn:
--
--   Tầng 1 (DO block) — bọc `auth.uid()` cho MỌI policy còn sót. Đọc text đang sống từ pg_policies
--   rồi viết lại, nên không cần dựng lại định nghĩa từ repo và không thể đạp lên bản sửa tay.
--   Đây là block của 20260505_fix_performance_advisor, sửa 2 lỗi: (a) nó bỏ qua cột `permissive`
--   nên policy RESTRICTIVE bị dựng lại thành PERMISSIVE — biến một hạn chế thành một cấp phép;
--   (b) đoạn "replace ngược cho chắc" không khớp cách Postgres in ra `( SELECT auth.uid() AS uid)`
--   nên chạy lại là lồng thêm một lớp select mỗi lần.
--
--   Tầng 2 (viết tay) — 5 policy ĐỌC MENU. Ở đây bọc mỗi `auth.uid()` là chưa đủ: cái đắt là
--   `is_admin_auth` (SECURITY DEFINER, query bảng users), và nó VẪN chạy per-row nếu chỉ bọc tham
--   số bên trong. Bọc cả biểu thức `(SELECT public.is_admin_auth(auth.uid()))` mới hoisting được
--   nguyên lời gọi hàm. Nạp menu 40 món: 40 lượt query users → 1.
--   Chỉ 5 bảng này mới đáng viết tay vì mỗi query trả về hàng trăm dòng.
--
-- VẤN ĐỀ 2 — multiple_permissive_policies (0006). extra_ings_write khai `FOR ALL`, mà ALL gồm cả
-- SELECT ⇒ mỗi lần đọc extra_ingredients chạy CẢ HAI policy. Đọc chưa bao giờ cần nó: tập hợp mà
-- extra_ings_write cho phép là TẬP CON của extra_ings_read (read cho nhân viên + hàng mẫu
-- address_id NULL; write đòi quản lý). Tách thành INSERT/UPDATE/DELETE — không mất quyền nào.
--
-- ĐỪNG gộp lại thành FOR ALL: 20260711_drop_legacy_extra_ingredients_policies từng gộp cho gọn và
-- chính cái gọn đó đẻ ra cảnh báo này. (Danh sách split của 20260505 vẫn ghi tên cũ
-- 'extra_ingredients_write' — tên đó đã bị xoá năm ngoái, nên block generic không bắt được.)
--
-- upsertExtraIngredient dùng INSERT ... ON CONFLICT DO UPDATE, cần đủ cả ba: INSERT WITH CHECK,
-- UPDATE USING (dòng đang có) và UPDATE WITH CHECK (dòng sau khi sửa). Đủ cả ba bên dưới.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

-- ── Tầng 1: bọc auth.uid() cho mọi policy còn sót ────────────────────────────────────────
DO $$
DECLARE
    pol         RECORD;
    qual_expr   TEXT;
    check_expr  TEXT;
    role_list   TEXT;
    stmt        TEXT;
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
    LOOP
        qual_expr  := pol.qual;
        check_expr := pol.with_check;

        -- Bỏ qua biểu thức đã bọc rồi. Postgres in ra `( SELECT auth.uid() AS uid)`, nên so theo
        -- 'SELECT auth.uid()' mới khớp — bản 20260505 so theo '(select auth.uid())' và không bao
        -- giờ khớp, nên mỗi lần chạy lại là lồng thêm một lớp.
        --
        -- ponytail: policy vừa có chỗ đã bọc vừa có chỗ chưa thì bị bỏ qua cả cụm. Chưa gặp ca
        -- nào như vậy; gặp thì viết tay như tầng 2.
        IF qual_expr LIKE '%auth.uid()%' AND qual_expr NOT LIKE '%SELECT auth.uid()%' THEN
            qual_expr := REPLACE(qual_expr, 'auth.uid()', '(SELECT auth.uid())');
        END IF;
        IF check_expr LIKE '%auth.uid()%' AND check_expr NOT LIKE '%SELECT auth.uid()%' THEN
            check_expr := REPLACE(check_expr, 'auth.uid()', '(SELECT auth.uid())');
        END IF;

        CONTINUE WHEN qual_expr IS NOT DISTINCT FROM pol.qual
                  AND check_expr IS NOT DISTINCT FROM pol.with_check;

        role_list := array_to_string(pol.roles, ', ');
        IF role_list IS NULL OR role_list = '' THEN role_list := 'public'; END IF;

        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

        -- AS PERMISSIVE/RESTRICTIVE phải giữ đúng bản cũ. Dựng một policy RESTRICTIVE thành
        -- PERMISSIVE là lật ngược ý nghĩa của nó: từ "phải thoả thêm điều này" thành "thoả cái
        -- này là đủ". 20260505 bỏ sót chỗ này.
        stmt := format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
                       pol.policyname, pol.schemaname, pol.tablename,
                       pol.permissive, pol.cmd, role_list);
        IF qual_expr  IS NOT NULL THEN stmt := stmt || format(' USING (%s)', qual_expr); END IF;
        IF check_expr IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', check_expr); END IF;
        EXECUTE stmt;
    END LOOP;
END
$$;

-- ── Tầng 2: 5 policy đọc menu — hoisting cả lời gọi hàm ──────────────────────────────────
DROP POLICY IF EXISTS "products_read" ON products;
CREATE POLICY "products_read" ON products
    FOR SELECT
    USING (
        owner_address_id IS NULL
        OR (SELECT public.is_admin_auth(auth.uid()))
        OR owner_address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "recipes_read" ON recipes;
CREATE POLICY "recipes_read" ON recipes
    FOR SELECT
    USING (
        address_id IS NULL
        OR (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "costs_read" ON ingredient_costs;
CREATE POLICY "costs_read" ON ingredient_costs
    FOR SELECT
    USING (
        address_id IS NULL
        OR (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "extras_read" ON product_extras;
CREATE POLICY "extras_read" ON product_extras
    FOR SELECT
    USING (
        address_id IS NULL
        OR (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = (SELECT auth.uid())
        )
    );

-- extra_ingredients không có address_id riêng — vẫn phải đi qua product_extras cha. EXISTS giữ
-- nguyên per-row vì nó tham chiếu cột của dòng đang xét.
DROP POLICY IF EXISTS "extra_ings_read" ON extra_ingredients;
CREATE POLICY "extra_ings_read" ON extra_ingredients
    FOR SELECT
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR EXISTS (
            SELECT 1 FROM product_extras pe
            WHERE pe.id = extra_ingredients.extra_id
              AND (
                  pe.address_id IS NULL
                  OR pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = (SELECT auth.uid())
                  )
              )
        )
    );

-- ── Tầng 2b: bỏ SELECT khỏi policy ghi extra_ingredients ─────────────────────────────────
-- Cùng một biểu thức, chỉ khác chỗ gắn: INSERT dùng WITH CHECK (dòng sắp ghi), DELETE dùng USING
-- (dòng đang có), UPDATE cần cả hai.
DROP POLICY IF EXISTS "extra_ings_write" ON extra_ingredients;

DROP POLICY IF EXISTS "extra_ings_write_insert" ON extra_ingredients;
CREATE POLICY "extra_ings_write_insert" ON extra_ingredients
    FOR INSERT
    WITH CHECK (
        (SELECT public.is_admin_auth(auth.uid()))
        OR (
            (SELECT public.is_manager_auth(auth.uid()))
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = (SELECT auth.uid())
                  )
            )
        )
    );

DROP POLICY IF EXISTS "extra_ings_write_update" ON extra_ingredients;
CREATE POLICY "extra_ings_write_update" ON extra_ingredients
    FOR UPDATE
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR (
            (SELECT public.is_manager_auth(auth.uid()))
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = (SELECT auth.uid())
                  )
            )
        )
    )
    WITH CHECK (
        (SELECT public.is_admin_auth(auth.uid()))
        OR (
            (SELECT public.is_manager_auth(auth.uid()))
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = (SELECT auth.uid())
                  )
            )
        )
    );

DROP POLICY IF EXISTS "extra_ings_write_delete" ON extra_ingredients;
CREATE POLICY "extra_ings_write_delete" ON extra_ingredients
    FOR DELETE
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR (
            (SELECT public.is_manager_auth(auth.uid()))
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = (SELECT auth.uid())
                  )
            )
        )
    );

COMMIT;
