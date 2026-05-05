-- ==============================================================================================
-- 20260505_fix_index_advisor_final.sql
-- Description: Adds missing single-column index on address_id for orders table
-- ==============================================================================================

BEGIN;

-- Create index on address_id
CREATE INDEX IF NOT EXISTS idx_orders_address_id ON public.orders USING btree (address_id);

COMMIT;
