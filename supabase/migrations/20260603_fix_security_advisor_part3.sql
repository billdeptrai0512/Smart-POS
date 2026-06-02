-- ==============================================================================================
-- 20260603_fix_security_advisor_part3.sql
-- Description: Re-clear Supabase Security Advisor warnings that regressed after recent migrations.
--
-- Why they came back: CREATE OR REPLACE FUNCTION (and DROP + CREATE) reset function-level
-- settings (SET search_path) AND grants back to PostgreSQL defaults (EXECUTE to PUBLIC). Functions
-- redefined after the earlier hardening passes (20260505 / 20260508 / 20260520) lost both:
--   - process_ingredient_restock  → re-created (new signatures) in 20260527/28/29, 20260601/02
--   - bulk_create_orders          → re-created in 20260531
--   - expense category fns         → created in 20260525 without SET search_path / grant lockdown
--   - ingredient seed fns          → created in 20260518/20260523 with PUBLIC default still in place
--
-- This migration is idempotent and dated last (20260603) so it runs AFTER every function
-- (re)definition on a fresh `supabase db reset`.
--
-- The dynamic DO-block (matching the 20260505 idiom) resolves every overload of a function name
-- via pg_proc, so we never hit "function does not exist" on a signature mismatch.
--
-- 1. function_search_path_mutable (0011) — 7 functions:
--    bulk_create_orders, get_daily_report_context, get_report_by_date, get_report_by_range,
--    seed_default_expense_categories, trg_seed_expense_categories,
--    trg_touch_expense_categories_updated_at
--    → ALTER FUNCTION ... SET search_path = public. Pure hardening, no behavior change.
--
-- 2. anon_security_definer_function_executable (0028) — revoke anon on every flagged function.
--
-- 3. authenticated_security_definer_function_executable (0029):
--    - Trigger / internal-only fns (trg_seed_expense_categories, trg_touch_*,
--      trigger_seed_address_ingredient_costs, seed_default_expense_categories,
--      seed_default_ingredient_costs) are NOT meant to be called via /rest/v1/rpc at all. They
--      only ever run as triggers or are PERFORMed by SECURITY DEFINER trigger fns (which run as
--      the function owner, so the inner EXECUTE check passes regardless of role grants). Trigger
--      firing itself does not check EXECUTE. → revoke PUBLIC + anon + authenticated.
--    - The remaining 0029 warnings on RLS helpers (auth_owner_id, can_write_address,
--      is_admin_auth, is_manager_auth) and on RPCs the authenticated client legitimately calls
--      (bulk_create_orders, cancel_restock, clone_default_menu, delete_ingredient,
--      get_default_ingredient_stocks, get_ingredient_stocks, get_ingredient_stocks_v2,
--      process_ingredient_restock, record_invoice_payment, remove_team_member,
--      set_team_member_role, sync_ingredient_key, update_extras_sort_order,
--      update_products_sort_order) are INTENTIONAL — those are supposed to be callable by
--      signed-in users and enforce their own ownership/role guards. Left unchanged.
-- ==============================================================================================

BEGIN;

-- ------------------------------------------------------------------------------------------
-- 1. function_search_path_mutable — re-apply SET search_path = public (all overloads)
-- ------------------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'bulk_create_orders',
              'get_daily_report_context',
              'get_report_by_date',
              'get_report_by_range',
              'seed_default_expense_categories',
              'trg_seed_expense_categories',
              'trg_touch_expense_categories_updated_at'
          )
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = public', rec.func_sig);
    END LOOP;
END
$$;

-- ------------------------------------------------------------------------------------------
-- 2. Trigger / internal-only functions — revoke PUBLIC + anon + authenticated (all overloads)
--    Triggers still fire; SECURITY DEFINER trigger fns still PERFORM the seed fns as owner.
-- ------------------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'trg_seed_expense_categories',
              'trg_touch_expense_categories_updated_at',
              'trigger_seed_address_ingredient_costs',
              'seed_default_expense_categories',
              'seed_default_ingredient_costs'
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', rec.func_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', rec.func_sig);
    END LOOP;
END
$$;

-- ------------------------------------------------------------------------------------------
-- 3. Client RPCs — revoke PUBLIC + anon, keep authenticated (all overloads)
-- ------------------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'bulk_create_orders',
              'get_default_ingredient_stocks',
              'process_ingredient_restock',
              'record_invoice_payment'
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', rec.func_sig);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', rec.func_sig);
        EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', rec.func_sig);
    END LOOP;
END
$$;

COMMIT;
