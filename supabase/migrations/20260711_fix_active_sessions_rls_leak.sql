-- =============================================
-- Fix cross-tenant leak on active_sessions
-- =============================================
-- `sessions_full_access` was `FOR ALL USING (auth.uid() IS NOT NULL)` since the
-- table's original creation — never tightened by any later migration. Any
-- logged-in user, from ANY tenant, could SELECT every other business's active
-- sessions (who's on shift, at which address_id) and UPDATE/DELETE/INSERT
-- arbitrary rows (e.g. force another tenant's staff "offline", spoof a session).
--
-- Fix: same ownership-guard shape used everywhere else (CLAUDE.md) — admin OR
-- own team's addresses OR user_address_access — scoped through active_sessions.address_id.
--
-- Safe to run multiple times: DROP IF EXISTS / CREATE.

DROP POLICY IF EXISTS "sessions_full_access" ON active_sessions;
CREATE POLICY "sessions_full_access" ON active_sessions
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT id FROM addresses WHERE manager_id = public.auth_owner_id(auth.uid())
        )
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );
