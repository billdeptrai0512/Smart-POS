-- =============================================
-- Fix critical data leak: users + invite_tokens readable by anon
-- =============================================
-- Reported: an outside party pulled 53 rows (id/role/username/phone) out of the
-- live app with no login. Root cause confirmed in schema.sql: `profiles_read`
-- on `users` was `FOR SELECT USING (true)` — same shape as the menu-table leak
-- fixed in 20260710_fix_menu_read_rls_leak.sql, just missed on that pass.
-- GET /rest/v1/users?select=* returned every row to the anon key.
--
-- Found the same shape on invite_tokens while fixing this: `invite_read USING
-- (true)` let anon dump every outstanding invite token (the actual secret used
-- to self-join a team) plus its manager_id — worse than the users leak, since it
-- lets an attacker join someone else's team, not just read names. The only
-- client code that read this table anonymously (authService.validateInviteToken)
-- is dead — unreferenced by any route/component in src/ — so tightening this
-- doesn't need a replacement RPC, it just closes the direct-API hole.
--
-- Safe to run multiple times: DROP IF EXISTS / CREATE.

DROP POLICY IF EXISTS "profiles_read" ON users;
CREATE POLICY "profiles_read" ON users
    FOR SELECT
    USING (
        auth.uid() IS NOT NULL
        AND (
            auth_id = auth.uid()
            OR public.is_admin_auth(auth.uid())
            OR id = public.auth_owner_id(auth.uid())
            OR manager_id = public.auth_owner_id(auth.uid())
        )
    );

DROP POLICY IF EXISTS "invite_read" ON invite_tokens;
CREATE POLICY "invite_read" ON invite_tokens
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
    );
