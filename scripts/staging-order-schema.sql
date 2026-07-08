-- STAGING ORDER SCHEMA (subset) — chỉ để test bulk_create_orders (tiền BÁN HÀNG: giá bán +
-- giá vốn tự tính server-side từ products/recipes, xem migration 20260708). KHÔNG phải full
-- app schema. Tiền nhập kho (process_ingredient_restock) có schema riêng, xem
-- scripts/staging-inventory-schema.sql — file này lặp lại users/addresses/helper functions
-- của file đó (idempotent, IF NOT EXISTS / CREATE OR REPLACE) để tự chạy độc lập được.
-- Sinh tự động từ supabase/schema.sql + migrations. Paste vào SQL Editor STAGING, Run.

-- ============ TABLES (dùng chung, giống staging-inventory-schema.sql) ============
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff', 'admin')),
  manager_id UUID REFERENCES users(id),
  email TEXT,
  password TEXT NOT NULL DEFAULT '',
  username TEXT
);

CREATE TABLE IF NOT EXISTS addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ingredient_sort_order JSONB DEFAULT '[]',
  referred_from_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL,
  referral_rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_address_access (
    auth_id UUID NOT NULL,
    address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    PRIMARY KEY (auth_id, address_id)
);

CREATE OR REPLACE FUNCTION public.auth_owner_id(p_auth_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(manager_id, id) FROM users WHERE auth_id = p_auth_id; $$;

CREATE OR REPLACE FUNCTION public.is_admin_auth(p_auth_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = p_auth_id AND role = 'admin'); $$;

-- ============ TABLES (đặc thù order pricing) ============
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  owner_address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER,
  count_as_cup BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS product_extras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  is_sticky BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'đv',
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (product_id, ingredient, address_id)
);

CREATE TABLE IF NOT EXISTS ingredient_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient TEXT NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'đv',
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (ingredient, address_id)
);

CREATE TABLE IF NOT EXISTS extra_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  extra_id UUID REFERENCES product_extras(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'đv',
  UNIQUE (extra_id, ingredient)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  total INTEGER NOT NULL,
  total_cost INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  staff_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL,
  options TEXT,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  extra_ids JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ============ RPC: bulk_create_orders (từ 20260708_bulk_create_orders_server_pricing.sql) ============
BEGIN;

CREATE OR REPLACE FUNCTION bulk_create_orders(orders_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_rec JSONB;
  item_rec JSONB;
  extra_id_txt TEXT;
  recipe_rec RECORD;
  ei_rec RECORD;
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
  v_address_id UUID;
  v_discount_amount INTEGER;
  v_order_total INTEGER;
  v_order_cost NUMERIC;
  v_product_id UUID;
  v_quantity INTEGER;
  v_extra_ids JSONB;
  v_unit_price INTEGER;
  v_extras_price INTEGER;
  v_extra_price INTEGER;
  v_extra_name TEXT;
  v_options_text TEXT;
  v_line_cogs NUMERIC;
  v_ing_cost INTEGER;
BEGIN
  FOR order_rec IN SELECT * FROM jsonb_array_elements(orders_payload)
  LOOP
    v_address_id := (order_rec->>'address_id')::UUID;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = v_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', v_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());
    v_discount_amount := COALESCE((order_rec->>'discount_amount')::INTEGER, 0);

    INSERT INTO orders (id, total, total_cost, discount_amount, payment_method, address_id, staff_name, created_at)
    VALUES (
      COALESCE((order_rec->>'id')::UUID, gen_random_uuid()),
      0, 0, v_discount_amount,
      order_rec->>'payment_method',
      v_address_id,
      order_rec->>'staff_name',
      new_order_time
    )
    RETURNING id INTO new_order_id;

    v_order_total := 0;
    v_order_cost := 0;

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      v_product_id := (item_rec->>'product_id')::UUID;
      v_quantity := (item_rec->>'quantity')::INTEGER;
      v_extra_ids := COALESCE(item_rec->'extra_ids', '[]'::JSONB);

      SELECT price INTO v_unit_price FROM products WHERE id = v_product_id AND owner_address_id = v_address_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid product % for address %', v_product_id, v_address_id USING ERRCODE = 'invalid_parameter_value';
      END IF;

      v_extras_price := 0;
      v_options_text := NULL;
      FOR extra_id_txt IN SELECT * FROM jsonb_array_elements_text(v_extra_ids)
      LOOP
        SELECT price, name INTO v_extra_price, v_extra_name
        FROM product_extras
        WHERE id = extra_id_txt::UUID AND product_id = v_product_id AND address_id = v_address_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Invalid extra % for product %', extra_id_txt, v_product_id USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_extras_price := v_extras_price + v_extra_price;
        v_options_text := CASE WHEN v_options_text IS NULL THEN v_extra_name ELSE v_options_text || ', ' || v_extra_name END;
      END LOOP;

      v_order_total := v_order_total + (v_unit_price + v_extras_price) * v_quantity;

      v_line_cogs := 0;
      FOR recipe_rec IN SELECT ingredient, amount FROM recipes WHERE product_id = v_product_id AND address_id = v_address_id
      LOOP
        SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = recipe_rec.ingredient AND address_id = v_address_id;
        v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * recipe_rec.amount;
      END LOOP;
      FOR extra_id_txt IN SELECT * FROM jsonb_array_elements_text(v_extra_ids)
      LOOP
        FOR ei_rec IN SELECT ingredient, amount FROM extra_ingredients WHERE extra_id = extra_id_txt::UUID
        LOOP
          SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = ei_rec.ingredient AND address_id = v_address_id;
          v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * ei_rec.amount;
        END LOOP;
      END LOOP;
      v_order_cost := v_order_cost + v_line_cogs * v_quantity;

      INSERT INTO order_items (order_id, product_id, quantity, options, unit_cost, extra_ids)
      VALUES (new_order_id, v_product_id, v_quantity, v_options_text, ROUND(v_line_cogs)::INTEGER, v_extra_ids);
    END LOOP;

    UPDATE orders SET total = v_order_total - v_discount_amount, total_cost = ROUND(v_order_cost)::INTEGER
    WHERE id = new_order_id;
  END LOOP;
END;
$$;

COMMIT;

-- ============ TEST GRANT: cho service_role gọi RPC (staging test only) ============
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
