-- =============================================
-- Coffee Cart Order App – Supabase Schema
-- =============================================
-- Reflects the schema actually in use by the application code.
-- Drift can creep in via the Supabase dashboard; if you change the DB there,
-- mirror the change here too.

-- Users profiles (managers and staff, linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff', 'admin')),
  manager_id UUID REFERENCES users(id), -- staff belongs to a manager
  email TEXT,
  password TEXT NOT NULL DEFAULT ''
);

-- Addresses (locations managed by a manager)
CREATE TABLE IF NOT EXISTS addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ingredient_sort_order JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate address names per manager (case/space-insensitive).
-- Backstop for the client-side check; required to defeat concurrent-tab races.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_manager_name_unique
  ON addresses (manager_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')));

-- Invite tokens for staff onboarding
CREATE TABLE IF NOT EXISTS invite_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Products (menu items) — per-address isolated.
-- Each address owns its own clone of every product (set via owner_address_id).
-- Rows with owner_address_id IS NULL are the global "default template" used by
-- the admin "Mẫu mặc định" view.
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL, -- price in VND
  is_active BOOLEAN DEFAULT true,
  owner_address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER,
  count_as_cup BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_products_owner_address
  ON products (owner_address_id) WHERE is_active;

-- Recipes (ingredients per product, address_id NULL = global default)
CREATE TABLE IF NOT EXISTS recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL, -- amount used per 1 serving
  unit TEXT NOT NULL DEFAULT 'đv', -- ingredient unit (g, ml, ly, etc.)
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE, -- null means default recipe
  UNIQUE NULLS NOT DISTINCT (product_id, ingredient, address_id)
);

-- Inventory (current stock)
CREATE TABLE IF NOT EXISTS inventory (
  ingredient TEXT PRIMARY KEY,
  stock REAL NOT NULL DEFAULT 0
);

-- Ingredient costs (unit cost per ingredient, address_id NULL = global default)
CREATE TABLE IF NOT EXISTS ingredient_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient TEXT NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0, -- cost per unit in VND
  unit TEXT NOT NULL DEFAULT 'đv', -- ingredient unit (g, ml, ly, etc.)
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE, -- null means default cost
  UNIQUE NULLS NOT DISTINCT (ingredient, address_id)
);

-- Orders (scoped to address)
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  total INTEGER NOT NULL, -- total in VND
  total_cost INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL
);

-- Expenses (manual one-off costs)
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL, -- cost in VND
  staff_name TEXT,
  is_fixed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fixed monthly costs (rent, salary etc.) per address — soft-delete via is_active=false
CREATE TABLE IF NOT EXISTS fixed_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Product extras (per-product quick options, e.g. "Lớn" +6000đ)
CREATE TABLE IF NOT EXISTS product_extras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  is_sticky BOOLEAN NOT NULL DEFAULT false
);

-- Extra ingredients (ingredients consumed by a product extra)
CREATE TABLE IF NOT EXISTS extra_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  extra_id UUID REFERENCES product_extras(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'đv',
  UNIQUE (extra_id, ingredient)
);

-- Active sessions (track who is currently on shift at which address)
CREATE TABLE IF NOT EXISTS active_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Shift closings (end-of-shift reports per address)
CREATE TABLE IF NOT EXISTS shift_closings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE NOT NULL,
  closed_by UUID REFERENCES users(id),
  system_total_revenue BIGINT NOT NULL DEFAULT 0,
  actual_cash BIGINT NOT NULL DEFAULT 0,
  actual_transfer BIGINT NOT NULL DEFAULT 0,
  inventory_report JSONB DEFAULT '[]',
  note TEXT DEFAULT '',
  closed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_closings_address_date
  ON shift_closings (address_id, closed_at DESC);

-- =============================================
-- Deprecated tables (commit 43af730 "new design of database product on address")
-- =============================================
-- The product menu used to be a many-to-many link via address_products and
-- per-address price overrides via product_prices. Both are now obsolete:
-- products.owner_address_id + products.price replaces them entirely.
-- Drop only after confirming nothing in production reads these.
DROP TABLE IF EXISTS address_products CASCADE;
DROP TABLE IF EXISTS product_prices CASCADE;

-- =============================================
-- Row Level Security Policies
-- =============================================

-- Active sessions: authenticated users can manage sessions
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_full_access" ON active_sessions;
CREATE POLICY "sessions_full_access" ON active_sessions
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Orders: managers and admins can access orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_full_access" ON orders;
CREATE POLICY "managers_full_access" ON orders
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Order items: cascade through orders
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_order_items" ON order_items;
CREATE POLICY "managers_order_items" ON order_items
  FOR ALL USING (
    order_id IN (
      SELECT o.id FROM orders o
      WHERE o.address_id IN (
        SELECT a.id FROM addresses a
        JOIN users u ON u.id = a.manager_id
        WHERE u.auth_id = auth.uid() OR u.id IN (
          SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
        )
      )
      OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    )
  );

-- Products: read for all, write for authenticated managers
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read" ON products;
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_read" ON products FOR SELECT USING (true);
CREATE POLICY "products_write" ON products FOR ALL USING (auth.uid() IS NOT NULL);

-- Recipes: read for all, write for authenticated managers
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipes_read" ON recipes;
DROP POLICY IF EXISTS "recipes_write" ON recipes;
CREATE POLICY "recipes_read" ON recipes FOR SELECT USING (true);
CREATE POLICY "recipes_write" ON recipes FOR ALL USING (auth.uid() IS NOT NULL);

-- Ingredient costs: read for all, write for authenticated managers
ALTER TABLE ingredient_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "costs_read" ON ingredient_costs;
DROP POLICY IF EXISTS "costs_write" ON ingredient_costs;
CREATE POLICY "costs_read" ON ingredient_costs FOR SELECT USING (true);
CREATE POLICY "costs_write" ON ingredient_costs FOR ALL USING (auth.uid() IS NOT NULL);

-- Product extras: read for all, write for authenticated managers
ALTER TABLE product_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "extras_read" ON product_extras;
DROP POLICY IF EXISTS "extras_write" ON product_extras;
CREATE POLICY "extras_read" ON product_extras FOR SELECT USING (true);
CREATE POLICY "extras_write" ON product_extras FOR ALL USING (auth.uid() IS NOT NULL);

-- Extra ingredients: read for all, write for authenticated managers
ALTER TABLE extra_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "extra_ings_read" ON extra_ingredients;
DROP POLICY IF EXISTS "extra_ings_write" ON extra_ingredients;
CREATE POLICY "extra_ings_read" ON extra_ingredients FOR SELECT USING (true);
CREATE POLICY "extra_ings_write" ON extra_ingredients FOR ALL USING (auth.uid() IS NOT NULL);

-- Expenses: managers and admins can access expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_expenses" ON expenses;
CREATE POLICY "managers_expenses" ON expenses
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Fixed costs: same access pattern as expenses
ALTER TABLE fixed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_fixed_costs" ON fixed_costs;
CREATE POLICY "managers_fixed_costs" ON fixed_costs
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Addresses: users can access addresses belonging to their manager (if staff) or themselves (if manager) or all (admin)
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_own_addresses" ON addresses;
CREATE POLICY "managers_own_addresses" ON addresses
  FOR ALL USING (
    manager_id IN (
      SELECT u.id FROM users u WHERE u.auth_id = auth.uid() AND u.role = 'manager'
    )
    OR manager_id IN (
      SELECT u.manager_id FROM users u WHERE u.auth_id = auth.uid() AND role = 'staff'
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Invite tokens: managers can create/read their own, anyone can validate (for signup)
ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invite_read" ON invite_tokens;
DROP POLICY IF EXISTS "invite_write" ON invite_tokens;
CREATE POLICY "invite_read" ON invite_tokens FOR SELECT USING (true);
CREATE POLICY "invite_write" ON invite_tokens FOR ALL USING (auth.uid() IS NOT NULL);

-- Shift closings: managers and admins
ALTER TABLE shift_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_shift_closings" ON shift_closings;
CREATE POLICY "managers_shift_closings" ON shift_closings
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Users profiles: users can read all profiles (needed for signup manager selection) but only insert own
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_read" ON users;
DROP POLICY IF EXISTS "insert_profile" ON users;
DROP POLICY IF EXISTS "managers_read_all" ON users;
DROP POLICY IF EXISTS "read_own_profile" ON users;

-- Enable anyone to read users (required so the Signup page can list managers)
CREATE POLICY "profiles_read" ON users
  FOR SELECT USING (true);
CREATE POLICY "insert_profile" ON users
  FOR INSERT WITH CHECK (auth_id = auth.uid());

-- =============================================
-- Enable Realtime for orders and inventory
-- =============================================
-- Note: Supabase will ignore these if already added
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE inventory;


-- =============================================
-- RPC: bulk_create_orders
-- =============================================
CREATE OR REPLACE FUNCTION bulk_create_orders(orders_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_rec JSONB;
  item_rec JSONB;
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
BEGIN
  FOR order_rec IN SELECT * FROM jsonb_array_elements(orders_payload)
  LOOP
    -- use provided created_at if exists, else now()
    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());

    INSERT INTO orders (total, total_cost, payment_method, address_id, staff_name, created_at)
    VALUES (
      (order_rec->>'total')::INTEGER,
      COALESCE((order_rec->>'total_cost')::INTEGER, 0),
      order_rec->>'payment_method',
      (order_rec->>'address_id')::UUID,
      order_rec->>'staff_name',
      new_order_time
    )
    RETURNING id INTO new_order_id;

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      INSERT INTO order_items (order_id, product_id, quantity, options, unit_cost, extra_ids)
      VALUES (
        new_order_id,
        (item_rec->>'product_id')::UUID,
        (item_rec->>'quantity')::INTEGER,
        item_rec->>'options',
        COALESCE((item_rec->>'unit_cost')::INTEGER, 0),
        COALESCE(item_rec->'extra_ids', '[]'::JSONB)::UUID[]
      );
    END LOOP;
  END LOOP;
END;
$$;
