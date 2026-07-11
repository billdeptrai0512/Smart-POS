-- =============================================
-- Actually drop the deprecated address_products / product_prices tables
-- =============================================
-- schema.sql has carried `DROP TABLE IF EXISTS address_products/product_prices
-- CASCADE` since commit 43af730 ("new design of database product on address"),
-- documented as obsolete — replaced entirely by products.owner_address_id +
-- products.price. backupService.js confirms "no longer used". But the DROP
-- was apparently never actually run against production: a full pg_policies
-- dump on 2026-07-11 showed both tables still alive with the pre-redesign
-- policy shape — `*_read USING(true)` (world-readable) and `*_write_*
-- USING(auth.uid() IS NOT NULL)` (any authenticated user, any tenant, can
-- write/delete rows in tables that don't even back any current feature).
--
-- No code in src/ references either table (confirmed via grep). Safe to drop.

DROP TABLE IF EXISTS address_products CASCADE;
DROP TABLE IF EXISTS product_prices CASCADE;
