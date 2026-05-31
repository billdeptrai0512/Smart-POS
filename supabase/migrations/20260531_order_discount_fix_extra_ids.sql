-- =============================================================================
-- HOTFIX: bulk_create_orders extra_ids (regression from 20260531_order_discount)
-- =============================================================================
-- 20260531_order_discount.sql recreated bulk_create_orders from schema.sql,
-- which cast extra_ids to UUID[]:  COALESCE(item_rec->'extra_ids','[]')::UUID[].
-- That clobbered the live function and breaks order creation with SQLSTATE
-- 42846 ("cannot cast type jsonb to uuid[]").
--
-- order_items.extra_ids is a JSONB column (see jsonb_array_elements_text /
-- jsonb_array_length usage in 20260505_rpc_ingredient_stock.sql and the report
-- RPCs that emit oi.extra_ids verbatim). The payload's extra_ids is already a
-- jsonb array of id strings, so it is stored as-is — no cast.
--
-- Filename sorts AFTER 20260531_order_discount.sql so a fresh `db push` applies
-- this correction last; the two CREATE OR REPLACE bodies are otherwise identical.
-- =============================================================================

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

    INSERT INTO orders (total, total_cost, discount_amount, payment_method, address_id, staff_name, created_at)
    VALUES (
      (order_rec->>'total')::INTEGER,
      COALESCE((order_rec->>'total_cost')::INTEGER, 0),
      COALESCE((order_rec->>'discount_amount')::INTEGER, 0),
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
        COALESCE(item_rec->'extra_ids', '[]'::JSONB)
      );
    END LOOP;
  END LOOP;
END;
$$;
