-- =============================================
-- Performance indexes for hot paths under high load
-- =============================================
-- Add compound indexes to support:
--   - fetchTodayOrders / fetchOrdersByRange (orders by address + created_at DESC)
--   - fetchTodayExpenses / fetchExpensesByRange (expenses by address + created_at DESC)
--   - order_items lookup by order_id (RLS join + nested select)
--
-- Use CREATE INDEX CONCURRENTLY so this can be applied to a live production
-- database without locking the table. CONCURRENTLY cannot run inside a
-- transaction — execute each statement separately (e.g. paste into the
-- Supabase SQL editor one block at a time, or run via psql with autocommit).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_address_created
  ON orders (address_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_address_created
  ON expenses (address_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_items_order
  ON order_items (order_id);
