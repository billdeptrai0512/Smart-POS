-- ==============================================================================================
-- 20260713_bulk_create_orders_idempotent_retry.sql
-- Description: bulk_create_orders already accepted a client-supplied id (COALESCE(id,
-- gen_random_uuid())) but had no ON CONFLICT — a retry with the same id after the response
-- was lost (network drop between server commit and client ack) hit a duplicate-key error,
-- and the offline-sync retry path (src/hooks/useOfflineSync.js) treated ANY error as "whole
-- batch failed", requeuing the same orders forever. Worse, before this migration the offline
-- batch path (src/services/orderService.ts bulkSubmitOrders) didn't even send `id` in the
-- payload, so a retry minted a brand-new random id server-side — duplicating the order (and
-- its revenue) on every retry instead of erroring.
--
-- Fix: ON CONFLICT (id) DO NOTHING on the orders insert. If the row already exists (this
-- exact order was already committed by a previous call with the same id), RETURNING gives no
-- row — skip the item/pricing loop for that order entirely, since a prior successful call
-- already wrote its order_items and final totals. Each order_rec in the batch is independent,
-- so a partially-retried batch (some ids already committed, some new) is handled correctly
-- per-order.
--
-- Same signature (bulk_create_orders(JSONB)), so per CLAUDE.md this only needs search_path +
-- the ownership guard re-declared — REVOKE/GRANT included anyway to match the existing pattern.
-- ==============================================================================================

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

    -- Ownership guard. Allows admin / direct manager / co-manager via user_address_access.
    -- Skip when auth.uid() IS NULL (service_role / migrations bypass, mirroring RLS).
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

    -- Insert with placeholder totals, backfilled below once every line is priced —
    -- avoids computing each line twice (once to sum, once to insert order_items).
    -- Use client-supplied id if present (POS optimistic-UI identity / offline-sync retry
    -- identity), else default. ON CONFLICT DO NOTHING makes a retry of an id that already
    -- committed a no-op instead of a duplicate-key error or a second random-id row.
    INSERT INTO orders (id, total, total_cost, discount_amount, payment_method, address_id, staff_name, created_at)
    VALUES (
      COALESCE((order_rec->>'id')::UUID, gen_random_uuid()),
      0, 0, v_discount_amount,
      order_rec->>'payment_method',
      v_address_id,
      order_rec->>'staff_name',
      new_order_time
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO new_order_id;

    IF new_order_id IS NULL THEN
      -- Row already existed — a prior call with this id already fully committed
      -- order_items and totals. Nothing left to do for this order.
      CONTINUE;
    END IF;

    v_order_total := 0;
    v_order_cost := 0;

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      v_product_id := (item_rec->>'product_id')::UUID;
      v_quantity := (item_rec->>'quantity')::INTEGER;
      v_extra_ids := COALESCE(item_rec->'extra_ids', '[]'::JSONB);

      -- Selling price from the DB, never the client. The address match also closes a
      -- cross-tenant hole (referencing another shop's product_id).
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

      -- COGS: recipe ingredients of the product + of each selected extra, priced at
      -- this address's ingredient_costs (mirrors calculateItemCost in src/utils/inventory.js,
      -- now the source of truth instead of a client-side estimate).
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

REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) TO authenticated;

COMMIT;
