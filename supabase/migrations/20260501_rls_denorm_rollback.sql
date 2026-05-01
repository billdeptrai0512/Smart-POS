-- =============================================
-- RLS denormalization — ROLLBACK
-- =============================================
-- Run this only if step 2 caused problems (cashiers blocked from their data,
-- managers seeing wrong rows, etc.). It restores the original RLS policies
-- verbatim from supabase/schema.sql, undoing step 2.
--
-- The flat table user_address_access, helper functions, and triggers from
-- step 1 are LEFT IN PLACE — they are inert without step 2's policies and
-- harmless. Drop them separately at the bottom of this file if desired.

BEGIN;

-- ---- orders ----
DROP POLICY IF EXISTS "managers_full_access" ON orders;
CREATE POLICY "managers_full_access" ON orders
    FOR ALL USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid() OR u.id IN (
                SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

-- ---- order_items ----
DROP POLICY IF EXISTS "managers_order_items" ON order_items;
CREATE POLICY "managers_order_items" ON order_items
    FOR ALL USING (
        order_id IN (
            SELECT o.id FROM orders o
            WHERE o.address_id IN (
                SELECT a.id FROM addresses a
                JOIN users u ON u.id = a.manager_id
                WHERE u.auth_id = auth.uid() OR u.id IN (
                    SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
                )
            )
            OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
        )
    );

-- ---- expenses ----
DROP POLICY IF EXISTS "managers_expenses" ON expenses;
CREATE POLICY "managers_expenses" ON expenses
    FOR ALL USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid() OR u.id IN (
                SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

-- ---- fixed_costs ----
DROP POLICY IF EXISTS "managers_fixed_costs" ON fixed_costs;
CREATE POLICY "managers_fixed_costs" ON fixed_costs
    FOR ALL USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid() OR u.id IN (
                SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

-- ---- shift_closings ----
DROP POLICY IF EXISTS "managers_shift_closings" ON shift_closings;
CREATE POLICY "managers_shift_closings" ON shift_closings
    FOR ALL USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid() OR u.id IN (
                SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

-- ---- addresses ----
DROP POLICY IF EXISTS "managers_own_addresses" ON addresses;
CREATE POLICY "managers_own_addresses" ON addresses
    FOR ALL USING (
        manager_id IN (
            SELECT u.id FROM users u WHERE u.auth_id = auth.uid() AND u.role = 'manager'
        )
        OR manager_id IN (
            SELECT u.manager_id FROM users u WHERE u.auth_id = auth.uid() AND role = 'staff'
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

COMMIT;

-- =============================================
-- Optional cleanup — only after confirming you don't want step 2 again
-- =============================================
-- Uncomment to remove the staging table + helpers. Triggers below depend on
-- the table, so they're cleaned up by CASCADE.
--
-- DROP TRIGGER IF EXISTS trg_uaa_on_address_change ON addresses;
-- DROP TRIGGER IF EXISTS trg_uaa_on_user_change ON users;
-- DROP FUNCTION IF EXISTS uaa_on_address_change();
-- DROP FUNCTION IF EXISTS uaa_on_user_change();
-- DROP TABLE IF EXISTS user_address_access CASCADE;
-- DROP FUNCTION IF EXISTS public.is_admin_auth(UUID);
-- DROP FUNCTION IF EXISTS public.user_owner_id(UUID);
