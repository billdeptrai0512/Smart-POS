-- =============================================
-- Drop leftover legacy policies on extra_ingredients (duplicate-policy leak)
-- =============================================
-- pg_policies on production showed extra_ingredients carrying TWO generations
-- of policy at once:
--   - extra_ingredients_read   (SELECT, USING true)               <- legacy, wide open
--   - extra_ingredients_write_insert/update/delete (auth.uid() IS NOT NULL) <- legacy, no ownership check
--   - extra_ings_read          (SELECT, correctly scoped)          <- current, from 20260710 fix
--   - extra_ings_write                                             <- MISSING entirely in production
--
-- Postgres RLS ORs all permissive policies for a command together, so the
-- legacy `extra_ingredients_read USING(true)` alone made the whole table
-- anon-readable regardless of how tight extra_ings_read was — this is why
-- the 20260711_reassert_extra_ingredients_rls.sql fix appeared to do nothing
-- (it only ever touched extra_ings_read, which was already correct). Same
-- story on writes: extra_ingredients_write_update/delete had no ownership
-- check at all (any authenticated user, any tenant) and extra_ings_write
-- (the correctly-scoped one from 20260501_lock_menu_writes.sql) was never
-- actually applied to this table in production.
--
-- Fix: drop every legacy-named policy, and (re)create extra_ings_write to
-- match what 20260501_lock_menu_writes.sql / schema.sql already define.
--
-- Safe to run multiple times.

DROP POLICY IF EXISTS "extra_ingredients_read" ON extra_ingredients;
DROP POLICY IF EXISTS "extra_ingredients_write_insert" ON extra_ingredients;
DROP POLICY IF EXISTS "extra_ingredients_write_update" ON extra_ingredients;
DROP POLICY IF EXISTS "extra_ingredients_write_delete" ON extra_ingredients;
DROP POLICY IF EXISTS "extra_ingredients_write" ON extra_ingredients;

DROP POLICY IF EXISTS "extra_ings_write" ON extra_ingredients;
CREATE POLICY "extra_ings_write" ON extra_ingredients
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = auth.uid()
                  )
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = auth.uid()
                  )
            )
        )
    );
