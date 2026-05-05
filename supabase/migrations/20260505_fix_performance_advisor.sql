-- ==============================================================================================
-- 20260505_fix_performance_advisor.sql
-- Description: Fixes 41 performance warnings from Supabase Performance Advisor
-- 1. Drops duplicate indexes
-- 2. Drops redundant overlapping permissive policies
-- 3. Replaces `auth.uid()` with `(select auth.uid())` in RLS policies to prevent initplan slow downs
-- 4. Splits `FOR ALL` write policies into INSERT, UPDATE, DELETE to fix SELECT multiple permissive policy evaluation
-- ==============================================================================================

BEGIN;

-- ------------------------------------------------------------------------------------------
-- 1. DROP DUPLICATE & UNUSED INDEXES
-- ------------------------------------------------------------------------------------------
-- Duplicate indexes
DROP INDEX IF EXISTS public.idx_order_items_order_id;
DROP INDEX IF EXISTS public.idx_orders_address_date;
DROP INDEX IF EXISTS public.idx_shift_closings_address_date;

-- Unused indexes (detected by Supabase Advisor)
DROP INDEX IF EXISTS public.idx_fixed_costs_address_active;
DROP INDEX IF EXISTS public.idx_fixed_costs_address;
DROP INDEX IF EXISTS public.idx_orders_deleted;
DROP INDEX IF EXISTS public.idx_uaa_address_id;

-- ------------------------------------------------------------------------------------------
-- 1.5. CREATE INDEXES FOR UNINDEXED FOREIGN KEYS
-- ------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_active_sessions_address_id ON public.active_sessions(address_id);
CREATE INDEX IF NOT EXISTS idx_address_products_product_id ON public.address_products(product_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_costs_address_id ON public.ingredient_costs(address_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_manager_id ON public.invite_tokens(manager_id);
CREATE INDEX IF NOT EXISTS idx_product_extras_product_id ON public.product_extras(product_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_address_id ON public.product_prices(address_id);
CREATE INDEX IF NOT EXISTS idx_products_owner_address_id ON public.products(owner_address_id);
CREATE INDEX IF NOT EXISTS idx_shift_closings_closed_by ON public.shift_closings(closed_by);
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON public.users(manager_id);

-- ------------------------------------------------------------------------------------------
-- 2. DROP REDUNDANT POLICIES (Fixes some multiple_permissive_policies)
-- ------------------------------------------------------------------------------------------
-- `extra_ingredients` has both `extra_ingredients_write` and `extra_ings_write`
DROP POLICY IF EXISTS "extra_ings_write" ON public.extra_ingredients;

-- `fixed_costs` has both "Authenticated users can manage fixed_costs" and "managers_fixed_costs"
DROP POLICY IF EXISTS "Authenticated users can manage fixed_costs" ON public.fixed_costs;

-- `shift_closings` has both "Authenticated users can..." and "managers_shift_closings"
DROP POLICY IF EXISTS "Authenticated users can insert shift_closings" ON public.shift_closings;
DROP POLICY IF EXISTS "Authenticated users can select shift_closings" ON public.shift_closings;
DROP POLICY IF EXISTS "Authenticated users can update shift_closings" ON public.shift_closings;

-- `user_address_access` has uaa_self_read. Let's ensure no redundancies.
-- `invite_tokens` has overlapping authenticated_mark_token_used / managers_create_own_tokens.
-- We will leave invite_tokens specific ones alone and just split invite_write below.


-- ------------------------------------------------------------------------------------------
-- 3. PL/pgSQL DO BLOCK to FIX auth_rls_initplan & SPLIT multiple_permissive_policies on SELECT
-- ------------------------------------------------------------------------------------------
DO $$
DECLARE
    pol RECORD;
    create_stmt TEXT;
    qual_expr TEXT;
    check_expr TEXT;
    role_list TEXT;
    -- These are policies that are currently FOR ALL, but also have a *_read policy for SELECT.
    -- To avoid evaluating both on SELECT, we split these write policies into INSERT, UPDATE, DELETE.
    target_split_policies TEXT[] := ARRAY[
        'ap_write', 'extra_ingredients_write', 
        'prices_write', 'products_write', 'recipes_write', 
        'costs_write', 'extras_write', 'invite_write'
    ];
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
    LOOP
        qual_expr := pol.qual;
        check_expr := pol.with_check;
        
        -- Replace auth.uid() -> (select auth.uid()) and auth.jwt() -> (select auth.jwt())
        -- We do REPLACE backwards first just in case it was already replaced
        IF qual_expr LIKE '%auth.uid()%' THEN
            qual_expr := REPLACE(qual_expr, '(select auth.uid())', 'auth.uid()');
            qual_expr := REPLACE(qual_expr, 'auth.uid()', '(select auth.uid())');
        END IF;

        IF check_expr LIKE '%auth.uid()%' THEN
            check_expr := REPLACE(check_expr, '(select auth.uid())', 'auth.uid()');
            check_expr := REPLACE(check_expr, 'auth.uid()', '(select auth.uid())');
        END IF;

        IF qual_expr LIKE '%auth.jwt()%' THEN
            qual_expr := REPLACE(qual_expr, '(select auth.jwt())', 'auth.jwt()');
            qual_expr := REPLACE(qual_expr, 'auth.jwt()', '(select auth.jwt())');
        END IF;

        IF check_expr LIKE '%auth.jwt()%' THEN
            check_expr := REPLACE(check_expr, '(select auth.jwt())', 'auth.jwt()');
            check_expr := REPLACE(check_expr, 'auth.jwt()', '(select auth.jwt())');
        END IF;

        -- If policy expression changed, OR if it's one of the policies we need to split
        IF (qual_expr IS DISTINCT FROM pol.qual) OR (check_expr IS DISTINCT FROM pol.with_check) OR (pol.policyname = ANY(target_split_policies) AND pol.cmd = 'ALL') THEN
            
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
            
            role_list := 'public';
            IF pol.roles IS NOT NULL AND array_length(pol.roles, 1) > 0 THEN
                IF pol.roles[1] != 'public' THEN
                    role_list := array_to_string(pol.roles, ', ');
                END IF;
            END IF;

            -- If it's one of the policies that need splitting
            IF pol.policyname = ANY(target_split_policies) AND pol.cmd = 'ALL' THEN
                -- Create INSERT
                create_stmt := format('CREATE POLICY %I ON %I.%I FOR INSERT TO %s', pol.policyname || '_insert', pol.schemaname, pol.tablename, role_list);
                IF COALESCE(check_expr, qual_expr) IS NOT NULL THEN 
                    create_stmt := create_stmt || format(' WITH CHECK (%s)', COALESCE(check_expr, qual_expr));
                END IF;
                EXECUTE create_stmt;

                -- Create UPDATE
                create_stmt := format('CREATE POLICY %I ON %I.%I FOR UPDATE TO %s', pol.policyname || '_update', pol.schemaname, pol.tablename, role_list);
                IF qual_expr IS NOT NULL THEN 
                    create_stmt := create_stmt || format(' USING (%s)', qual_expr);
                END IF;
                IF COALESCE(check_expr, qual_expr) IS NOT NULL THEN 
                    create_stmt := create_stmt || format(' WITH CHECK (%s)', COALESCE(check_expr, qual_expr));
                END IF;
                EXECUTE create_stmt;

                -- Create DELETE
                create_stmt := format('CREATE POLICY %I ON %I.%I FOR DELETE TO %s', pol.policyname || '_delete', pol.schemaname, pol.tablename, role_list);
                IF qual_expr IS NOT NULL THEN 
                    create_stmt := create_stmt || format(' USING (%s)', qual_expr);
                END IF;
                EXECUTE create_stmt;

            ELSE
                -- Recreate normally (modified auth.uid)
                create_stmt := format('CREATE POLICY %I ON %I.%I FOR %s TO %s', pol.policyname, pol.schemaname, pol.tablename, pol.cmd, role_list);
                IF qual_expr IS NOT NULL THEN 
                    create_stmt := create_stmt || format(' USING (%s)', qual_expr);
                END IF;
                IF check_expr IS NOT NULL THEN 
                    create_stmt := create_stmt || format(' WITH CHECK (%s)', check_expr);
                END IF;
                EXECUTE create_stmt;
            END IF;
        END IF;
    END LOOP;
END
$$;

COMMIT;
