-- =============================================
-- RLS denormalization — STEP 2 of 2: Replace policies (DO NOT RUN BEFORE VERIFY)
-- =============================================
-- Prerequisites:
--   1. Step 1 setup migration has been applied
--   2. Verify queries returned 0 unexpected diff rows
--   3. You are running this during a low-traffic window
--
-- This step swaps the heavy nested RLS policies for fast flat-table lookups.
-- Each policy is dropped and re-created in a single transaction per table,
-- so partial failure leaves the original policy in place.
--
-- If anything looks wrong after this runs (cashiers reporting empty data,
-- managers seeing wrong tenant, etc.), run the rollback file immediately —
-- it restores the previous policies verbatim.
--
-- Wrapping the whole file in a transaction so all policies flip atomically:
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

-- ---- order_items (cascade through orders) ----
DROP POLICY IF EXISTS "managers_order_items" ON order_items;
CREATE POLICY "managers_order_items" ON order_items
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR order_id IN (
            SELECT o.id FROM orders o
            WHERE o.address_id IN (
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

-- ---- addresses (filter by membership in the access table) ----
DROP POLICY IF EXISTS "managers_own_addresses" ON addresses;
CREATE POLICY "managers_own_addresses" ON addresses
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );

COMMIT;

-- =============================================
-- Smoke test queries (run as authenticated user via Supabase SQL editor
-- with "Run as authenticated" if available, OR via the actual app)
-- =============================================
-- 1. Login as a known manager → fetch today's orders → expect their orders
-- 2. Login as a known staff   → fetch today's orders → expect their manager's orders
-- 3. Login as an admin        → fetch today's orders → expect ALL orders
-- 4. Try to access another tenant's order_id directly via REST/RPC → expect 0 rows
