-- =============================================
-- Fix anon guest playground (part 2): permission denied for function is_admin_auth
-- =============================================
-- Same root cause as 20260716_grant_uaa_select_anon.sql: products_read/recipes_read/
-- costs_read/extras_read/extra_ings_read (20260710_fix_menu_read_rls_leak.sql) call
-- `public.is_admin_auth(auth.uid())` in their USING clause. The function was only
-- ever granted EXECUTE to `authenticated` (20260501_rls_denorm_step1_setup.sql:192),
-- so anon can't even plan the query — blocking the address_id IS NULL branch too.
--
-- Safe to grant to anon: is_admin_auth is SECURITY INVOKER (runs with the caller's
-- own privileges), and `users` already has RLS requiring `auth.uid() IS NOT NULL`
-- (20260711_fix_users_invite_rls_leak.sql) — so for anon (auth.uid() IS NULL) the
-- function's internal query always returns 0 rows, i.e. always resolves to false.
-- No admin-check bypass possible.
--
-- Safe to run multiple times.

GRANT EXECUTE ON FUNCTION public.is_admin_auth(UUID) TO anon;
