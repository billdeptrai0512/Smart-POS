-- ==============================================================================================
-- 20260814_fix_performance_advisor_menu_rls.sql
-- Description: hoisting auth.uid() ra khỏi vòng lặp per-row cho 5 policy ĐỌC MENU, và cắt
--              extra_ings_write khỏi đường SELECT.
--
-- VẤN ĐỀ 1 — auth_rls_initplan (0003). Policy viết `public.is_admin_auth(auth.uid())` thì
-- Postgres gọi lại hàm đó CHO TỪNG DÒNG. is_admin_auth là SECURITY DEFINER và bên trong nó
-- query bảng users ⇒ nạp menu 40 món = 40 lượt query users, chưa kể subquery user_address_access.
-- Bọc thành `(SELECT public.is_admin_auth(auth.uid()))` biến nó thành InitPlan: chạy MỘT lần
-- cho cả câu, giá trị dùng lại cho mọi dòng.
--
-- Vì sao đổi được mà không đổi ngữ nghĩa: mấy biểu thức này KHÔNG tham chiếu cột nào của dòng
-- đang xét, nên giá trị của chúng giống hệt nhau ở mọi dòng. Phần EXISTS(...) có tham chiếu
-- (extra_ingredients.extra_id, pe.address_id) thì GIỮ NGUYÊN per-row — không bọc.
--
-- VẤN ĐỀ 2 — multiple_permissive_policies (0006). extra_ings_write khai `FOR ALL`, mà ALL bao
-- gồm cả SELECT ⇒ mỗi lần đọc extra_ingredients chạy CẢ HAI policy (permissive nên OR lại).
-- Đọc chưa bao giờ cần tới nó: extra_ings_read đã rộng hơn hẳn (nhân viên đọc được, quản lý mới
-- ghi được). Tách thành 3 policy INSERT/UPDATE/DELETE — bỏ SELECT đi, quyền ghi giữ y nguyên.
--
-- ĐỪNG gộp lại thành FOR ALL: 20260711_drop_legacy_extra_ingredients_policies từng gộp cho gọn
-- và chính cái gọn đó đẻ ra cảnh báo này.
--
-- Chỉ đụng 5 bảng menu (products/recipes/ingredient_costs/product_extras/extra_ingredients) vì
-- đó là chỗ mỗi query trả về HÀNG TRĂM dòng. Chín policy còn lại advisor kêu nằm trên bảng đọc
-- vài dòng một lượt (active_sessions, app_ratings, warehouse_groups, users, order_sync_marks,
-- user_address_revoked) — sửa chỉ để tắt đèn vàng, mà mỗi lần viết lại một policy là một lần có
-- cơ hội làm thủng RLS. Không đáng.
--
-- CẢNH BÁO: file này DROP + CREATE theo bản định nghĩa TRONG REPO (20260710_fix_menu_read_rls_leak
-- và 20260711_*). Nếu policy trên prod từng bị sửa tay thì bản sửa tay đó mất.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

-- ── 1. Đọc menu: hoist auth.uid() ────────────────────────────────────────────────────────
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

-- extra_ingredients không có address_id riêng — vẫn phải đi qua product_extras cha, phần EXISTS
-- giữ nguyên per-row vì nó tham chiếu cột của dòng đang xét.
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

-- ── 2. Ghi extra_ingredients: bỏ SELECT khỏi policy ghi ──────────────────────────────────
-- Cùng một biểu thức, chỉ khác chỗ gắn: INSERT dùng WITH CHECK (dòng sắp ghi), DELETE dùng
-- USING (dòng đang có), UPDATE cần cả hai.
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
