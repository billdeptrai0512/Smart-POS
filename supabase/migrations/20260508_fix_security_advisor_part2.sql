-- ==============================================================================================
-- 20260508_fix_security_advisor_part2.sql
-- Description: Follow-up fixes for Supabase Security Advisor warnings.
--
-- 1. function_search_path_mutable:
--    `get_daily_report_context` was re-created in 20260505_fix_yesterday_closing.sql without
--    the SET search_path = public clause set in 20260505_fix_security_advisor.sql.
--    CREATE OR REPLACE drops function-level settings, so we re-apply it here.
--    (`subtract_stock_from_restock` is dropped entirely in 20260508_drop_legacy_inventory.sql.)
--
-- 2. anon_security_definer_function_executable:
--    The ingredient stock RPCs (`get_ingredient_stocks`, `get_ingredient_stocks_v2`,
--    `process_ingredient_restock`) are SECURITY DEFINER and currently grant EXECUTE to PUBLIC
--    by default. They are only ever called from the authenticated client. Revoke from PUBLIC
--    and anon, keep authenticated.
--
-- Note: the remaining `authenticated_security_definer_function_executable` warnings on the
-- auth helpers (`auth_owner_id`, `can_write_address`, `is_admin_auth`, `is_manager_auth`,
-- `clone_default_menu`) are intentional. Those helpers are referenced by RLS policies and
-- must run with elevated rights to read auth.users / bypass RLS. They were already locked
-- down to authenticated-only in 20260505_fix_security_advisor.sql.
-- ==============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Re-apply search_path = public on functions that lost it
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.get_daily_report_context(uuid) SET search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Revoke anon EXECUTE on ingredient RPCs; keep authenticated
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ingredient_stocks(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(uuid, text, numeric, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(uuid, text, numeric, numeric, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.process_ingredient_restock(uuid, text, numeric, numeric, text) TO authenticated;

COMMIT;
