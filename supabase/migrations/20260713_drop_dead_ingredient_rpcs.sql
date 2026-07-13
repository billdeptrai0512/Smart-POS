-- ==============================================================================================
-- 20260713_drop_dead_ingredient_rpcs.sql
-- Description: Drop 2 confirmed-dead ingredient RPCs, found during an architecture review.
-- Both have 0 call sites anywhere in src/, and no other SQL function calls either internally.
--
-- - ensure_ingredients_stock(): one-shot bootstrap from 20260510_add_ingredients_stock.sql,
--   already called once via `SELECT ensure_ingredients_stock();` in that same migration.
--   20260710_fix_search_path_regression.sql's own comments already call it "one-shot bootstrap
--   ... không còn cần thiết" (no longer needed).
-- - get_ingredient_stocks(p_address_id UUID): v1, from 20260505_rpc_ingredient_stock.sql.
--   Superseded by get_ingredient_stocks_v2 / get_default_ingredient_stocks, which are the only
--   ones called from src/services/ingredientService.ts.
-- ==============================================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.ensure_ingredients_stock();
DROP FUNCTION IF EXISTS public.get_ingredient_stocks(UUID);

COMMIT;
