-- =============================================
-- FIX MISSING INDEXES ON HIGH-TRAFFIC TABLES
-- =============================================
-- Root cause of Low Cache Hit Rate and high Disk IO:
-- Tables 'orders', 'order_items', 'expenses' have no indexes.
-- Every query against them is a full sequential scan, bypassing
-- the PostgreSQL shared_buffers cache entirely and going straight to disk.
-- 
-- Adding composite indexes on (address_id, created_at DESC) allows
-- Postgres to satisfy date-range queries from the cache, not disk.

-- orders: most queries filter by address_id + created_at range + deleted_at
CREATE INDEX IF NOT EXISTS idx_orders_address_created
  ON orders (address_id, created_at DESC);

-- Partial index on deleted orders (only indexes the small subset that IS deleted)
-- Allows WHERE deleted_at IS NOT NULL to be fast without adding overhead to normal queries
CREATE INDEX IF NOT EXISTS idx_orders_deleted
  ON orders (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- order_items: almost always queried via JOIN from orders (order_id FK)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items (order_id);

-- order_items: queried by product_id in stats and inventory calculation queries
CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON order_items (product_id);

-- expenses: queried by address_id + created_at range
CREATE INDEX IF NOT EXISTS idx_expenses_address_created
  ON expenses (address_id, created_at DESC);

-- users.auth_id: already in fix_disk_io.sql but ensure it exists
-- (every RLS check does a users lookup by auth_id)
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users (auth_id);
