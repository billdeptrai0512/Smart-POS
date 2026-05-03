-- =============================================
-- FIX HIGH DISK IO BUDGET DEPLETION
-- =============================================

-- 1. Create index on users.auth_id
-- Without this, every RLS check that uses auth.uid() to look up the user's role
-- or manager_id causes a FULL SEQUENTIAL SCAN of the users table.
-- When querying 100 rows of order_items, the DB does 100 sequential scans!
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users (auth_id);

-- 2. Re-apply optimized RLS policies (replacing heavy JOINs with flat table lookups)
-- The old policies did a 3-way join (orders -> addresses -> users) for EVERY row.
-- The new policies simply check if address_id is in user_address_access.

BEGIN;

-- ---- orders ----
DROP POLICY IF EXISTS "managers_full_access" ON orders;
CREATE POLICY "managers_full_access" ON orders
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );

-- ---- order_items ----
DROP POLICY IF EXISTS "managers_order_items" ON order_items;
CREATE POLICY "managers_order_items" ON order_items
    FOR ALL USING (
        order_id IN (
            SELECT id FROM orders
            WHERE public.is_admin_auth(auth.uid())
               OR address_id IN (
                   SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
               )
        )
    );

-- ---- expenses ----
DROP POLICY IF EXISTS "managers_expenses" ON expenses;
CREATE POLICY "managers_expenses" ON expenses
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );

-- ---- fixed_costs ----
DROP POLICY IF EXISTS "managers_fixed_costs" ON fixed_costs;
CREATE POLICY "managers_fixed_costs" ON fixed_costs
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );

-- ---- shift_closings ----
DROP POLICY IF EXISTS "managers_shift_closings" ON shift_closings;
CREATE POLICY "managers_shift_closings" ON shift_closings
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );

COMMIT;
