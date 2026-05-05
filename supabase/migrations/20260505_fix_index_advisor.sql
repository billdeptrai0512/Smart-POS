-- ==============================================================================================
-- 20260505_fix_index_advisor.sql
-- Description: Adds missing single-column date indexes suggested by Supabase Index Advisor
-- ==============================================================================================

BEGIN;

-- 1. Index for orders.created_at
-- Many queries sort and filter by date range heavily (Daily Report, Range Report)
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders USING btree (created_at DESC);

-- 2. Index for expenses.created_at
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON public.expenses USING btree (created_at DESC);

-- 3. Index for shift_closings.closed_at
CREATE INDEX IF NOT EXISTS idx_shift_closings_closed_at ON public.shift_closings USING btree (closed_at DESC);

COMMIT;
