-- =============================================
-- Coffee Cart Order App – Supabase Schema
-- =============================================

-- Users profiles (managers and staff, linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff', 'admin')),
  manager_id UUID REFERENCES users(id), -- staff belongs to a manager
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

-- Products (menu items)
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL, -- price in VND
  is_active BOOLEAN DEFAULT true
);

-- Product prices (overrides per address)
CREATE TABLE IF NOT EXISTS product_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  price INTEGER NOT NULL, -- price in VND
  UNIQUE (product_id, address_id)
);

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
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL
);

-- Expenses (manual costs)
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL, -- cost in VND
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Address-specific product menu (many-to-many with sort order)
CREATE TABLE IF NOT EXISTS address_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(address_id, product_id)
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
  address_id UUID REFERENCES addresses(id) NOT NULL,
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

-- Product prices: read for all, write for authenticated managers
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prices_read" ON product_prices;
DROP POLICY IF EXISTS "prices_write" ON product_prices;
CREATE POLICY "prices_read" ON product_prices FOR SELECT USING (true);
CREATE POLICY "prices_write" ON product_prices FOR ALL USING (auth.uid() IS NOT NULL);

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

-- Address products: read for all, write for authenticated managers
ALTER TABLE address_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ap_read" ON address_products;
DROP POLICY IF EXISTS "ap_write" ON address_products;
CREATE POLICY "ap_read" ON address_products FOR SELECT USING (true);
CREATE POLICY "ap_write" ON address_products FOR ALL USING (auth.uid() IS NOT NULL);

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
