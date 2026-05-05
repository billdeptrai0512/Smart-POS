-- =============================================
-- Optimize database queries with Composite Indexes
-- Based on Supabase Query Performance Advisor
-- =============================================

-- 1. Orders: Highly filtered by address_id and sorted by created_at
CREATE INDEX IF NOT EXISTS idx_orders_address_created ON public.orders USING btree (address_id, created_at DESC);

-- 2. Order Items: Highly joined with orders table
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items USING btree (order_id);

-- 3. Expenses: Highly filtered by address_id and sorted by created_at
CREATE INDEX IF NOT EXISTS idx_expenses_address_created ON public.expenses USING btree (address_id, created_at DESC);

-- 4. Shift Closings: Filtered by address_id and sorted by closed_at
CREATE INDEX IF NOT EXISTS idx_shift_closings_address_closed ON public.shift_closings USING btree (address_id, closed_at DESC);

-- 5. Recipes: Fetched entirely per address_id on startup
CREATE INDEX IF NOT EXISTS idx_recipes_address_id ON public.recipes USING btree (address_id);

-- 6. Product Extras: Filtered by address_id and ordered by sort_order
CREATE INDEX IF NOT EXISTS idx_product_extras_address_sort ON public.product_extras USING btree (address_id, sort_order ASC);

-- 7. Extra Ingredients: Fetched by extra_id
CREATE INDEX IF NOT EXISTS idx_extra_ingredients_extra_id ON public.extra_ingredients USING btree (extra_id);
