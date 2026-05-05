-- ==============================================================================================
-- 20260505_fix_performance_advisor_part2.sql
-- Description: Follow-up fixes for remaining Supabase Performance Advisor warnings
-- ==============================================================================================

BEGIN;

-- 1. DROP REDUNDANT POLICIES for invite_tokens
-- invite_write_insert and invite_write_update already cover these actions
DROP POLICY IF EXISTS "managers_create_own_tokens" ON public.invite_tokens;
DROP POLICY IF EXISTS "authenticated_mark_token_used" ON public.invite_tokens;

-- 2. CREATE MISSING INDEXES for unindexed foreign keys
CREATE INDEX IF NOT EXISTS idx_fixed_costs_address_id ON public.fixed_costs(address_id);
CREATE INDEX IF NOT EXISTS idx_user_address_access_address_id ON public.user_address_access(address_id);

COMMIT;
