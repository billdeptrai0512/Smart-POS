-- =============================================
-- Fix cross-tenant read leak on menu/config tables
-- =============================================
-- products_read / recipes_read / costs_read / extras_read / extra_ings_read
-- were left as `USING (true)` when 20260501_lock_menu_writes.sql tightened the
-- corresponding _write policies (that migration's own comment flagged this:
-- "Sanity: read policies are unchanged (still permissive)"). Any logged-in
-- user of ANY tenant could SELECT every other tenant's recipes and ingredient
-- costs — a real data leak between merchants sharing the same app.
--
-- Fix: same shape as the _write policies — allow the row when it's the
-- shared default template (owner_address_id / address_id IS NULL, needed for
-- anon guest playground via initGuestMode) OR the caller has
-- user_address_access to that address OR is admin.
--
-- Safe to run multiple times: DROP IF EXISTS / CREATE.

DROP POLICY IF EXISTS "products_read" ON products;
CREATE POLICY "products_read" ON products
    FOR SELECT
    USING (
        owner_address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR owner_address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "recipes_read" ON recipes;
CREATE POLICY "recipes_read" ON recipes
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "costs_read" ON ingredient_costs;
CREATE POLICY "costs_read" ON ingredient_costs
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "extras_read" ON product_extras;
CREATE POLICY "extras_read" ON product_extras
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = auth.uid()
        )
    );

-- extra_ingredients has no address_id of its own — resolve tenancy through
-- the parent product_extras row, same as extra_ings_write.
DROP POLICY IF EXISTS "extra_ings_read" ON extra_ingredients;
CREATE POLICY "extra_ings_read" ON extra_ingredients
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR EXISTS (
            SELECT 1 FROM product_extras pe
            WHERE pe.id = extra_ingredients.extra_id
              AND (
                  pe.address_id IS NULL
                  OR pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = auth.uid()
                  )
              )
        )
    );
