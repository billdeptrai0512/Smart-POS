BEGIN;

-- Helper functions must be SECURITY DEFINER to bypass RLS on the `users` table
CREATE OR REPLACE FUNCTION public.auth_owner_id(p_auth_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(manager_id, id) FROM users WHERE auth_id = p_auth_id;
$$;

CREATE OR REPLACE FUNCTION public.is_admin_auth(p_auth_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users WHERE auth_id = p_auth_id AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_manager_auth(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE auth_id = uid
          AND role IN ('manager', 'admin')
    );
$$;

-- Drop all old policies
DROP POLICY IF EXISTS "managers_own_addresses" ON addresses;
DROP POLICY IF EXISTS "addresses_read" ON addresses;
DROP POLICY IF EXISTS "addresses_write" ON addresses;
DROP POLICY IF EXISTS "managers_own_addresses_select" ON addresses;
DROP POLICY IF EXISTS "managers_own_addresses_insert" ON addresses;
DROP POLICY IF EXISTS "managers_own_addresses_update" ON addresses;
DROP POLICY IF EXISTS "managers_own_addresses_delete" ON addresses;
DROP POLICY IF EXISTS "addresses_select" ON addresses;
DROP POLICY IF EXISTS "addresses_insert" ON addresses;
DROP POLICY IF EXISTS "addresses_update" ON addresses;
DROP POLICY IF EXISTS "addresses_delete" ON addresses;

-- Create granular policies with manager_id fallback to fix the RETURNING clause bug
CREATE POLICY "addresses_select" ON addresses
    FOR SELECT USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
        OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
    );

CREATE POLICY "addresses_insert" ON addresses
    FOR INSERT WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
    );

CREATE POLICY "addresses_update" ON addresses
    FOR UPDATE USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
        OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
    );

CREATE POLICY "addresses_delete" ON addresses
    FOR DELETE USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
        OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
    );

-- Backfill user_address_access just in case
DELETE FROM user_address_access;
INSERT INTO user_address_access (auth_id, address_id)
SELECT u.auth_id, a.id
FROM users u
JOIN addresses a ON a.manager_id = COALESCE(u.manager_id, u.id)
WHERE u.auth_id IS NOT NULL
  AND u.role <> 'admin'
ON CONFLICT DO NOTHING;

COMMIT;
