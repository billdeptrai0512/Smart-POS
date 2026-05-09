-- ==============================================================================================
-- 20260508_drop_legacy_inventory.sql
-- Description: Drop the legacy `public.inventory` table and its trigger.
--
-- Background:
--   - `inventory(ingredient TEXT PK, stock REAL)` is a global, non-address-scoped table that
--     predates the multi-tenant rewrite.
--   - No client code reads from it. The current ingredient-stock UI uses
--     `get_ingredient_stocks_v2`, which derives stock from `shift_closings` + `expenses`.
--   - The only writer was the trigger `trg_subtract_stock` on `shift_closings`, executing
--     `subtract_stock_from_restock()`. That function is not SECURITY DEFINER and runs as the
--     calling role; with RLS enabled and zero policies on `inventory`, every UPDATE matches
--     zero rows -- the trigger has been a silent no-op.
--
-- Effect:
--   - Resolves the `rls_enabled_no_policy` advisor warning on `public.inventory`.
--   - Removes dead code; no behavior change for users.
-- ==============================================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_subtract_stock ON public.shift_closings;
DROP FUNCTION IF EXISTS public.subtract_stock_from_restock() CASCADE;
DROP TABLE IF EXISTS public.inventory;

COMMIT;
