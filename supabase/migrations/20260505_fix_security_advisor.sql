-- ==============================================================================================
-- 20260505_fix_security_advisor.sql
-- Description: Fixes warnings from Supabase Security Advisor
-- 1. function_search_path_mutable: explicitly set search_path to 'public' for functions
-- 2. Revokes public RPC access for internal triggers and auth-check functions
-- ==============================================================================================

BEGIN;

-- ------------------------------------------------------------------------------------------
-- 1 & 2. FIX function_search_path_mutable & SECURITY DEFINER permissions
-- ------------------------------------------------------------------------------------------
-- We use a DO block to dynamically fetch the exact function signature (including arguments)
-- so we don't hit "function does not exist" errors due to argument mismatch.

DO $$
DECLARE
    rec RECORD;
BEGIN
    -- Loop through all functions that need their search_path secured
    FOR rec IN 
        SELECT p.oid::regprocedure AS func_sig, p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'user_owner_id', 'bulk_create_orders', 'get_report_by_date', 
              'get_report_by_range', 'get_today_stats', 'get_daily_report_context', 
              'get_branches_today_stats', 'whoami_debug', 'evaluate_addr_check', 
              'migrate_existing_branches', 'auth_owner_id', 'can_write_address', 
              'clone_default_menu', 'is_admin_auth', 'is_manager_auth', 
              'rls_auto_enable', 'trigger_clone_on_new_address', 'uaa_on_address_change', 
              'uaa_on_user_change'
          )
    LOOP
        -- 1. Secure search_path
        EXECUTE format('ALTER FUNCTION %s SET search_path = public', rec.func_sig);
        
        -- 2. Handle Execution Permissions for SECURITY DEFINER and internal functions
        IF rec.proname IN (
              'rls_auto_enable', 'trigger_clone_on_new_address', 
              'uaa_on_address_change', 'uaa_on_user_change',
              'auth_owner_id', 'can_write_address', 'is_admin_auth', 
              'is_manager_auth', 'clone_default_menu'
        ) THEN
            -- Revoke from everyone by default
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', rec.func_sig);
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', rec.func_sig);
            
            -- Grant back ONLY to authenticated users for auth/logic helpers
            IF rec.proname IN ('auth_owner_id', 'can_write_address', 'is_admin_auth', 'is_manager_auth', 'clone_default_menu') THEN
                EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', rec.func_sig);
            END IF;
        END IF;
    END LOOP;
END
$$;

COMMIT;
