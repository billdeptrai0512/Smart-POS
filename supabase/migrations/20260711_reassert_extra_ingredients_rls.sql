-- =============================================
-- Re-assert extra_ingredients RLS (found still open in production)
-- =============================================
-- 20260710_fix_menu_read_rls_leak.sql tightened extra_ings_read alongside
-- products/recipes/costs/extras, but a live pentest on 2026-07-11 found
-- extra_ingredients still fully anon-readable (1558 rows, 28+ distinct
-- extra_id) while the other four tables in that same migration correctly
-- reject anon with "permission denied for table user_address_access". The
-- policy text below is unchanged from 20260710 — just re-applying it in case
-- that statement never landed (partial run) or was reverted by hand after.
--
-- Safe to run multiple times: DROP IF EXISTS / CREATE.

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
