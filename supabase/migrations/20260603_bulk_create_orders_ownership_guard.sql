-- ==============================================================================================
-- 20260603_bulk_create_orders_ownership_guard.sql
-- Description: Close a cross-tenant write hole in bulk_create_orders.
--
-- bulk_create_orders is SECURITY DEFINER (it bypasses RLS) and inserts orders using the
-- address_id taken straight from the client payload, with NO check that the caller actually
-- has write access to that address. An authenticated user A could pass shop B's address_id and
-- write orders / inflate-or-deflate revenue into B's books.
--
-- This mirrors the ownership guard added to process_ingredient_restock / sync_ingredient_key in
-- 20260520_security_hardening.sql: admin OR direct manager OR co-manager via user_address_access.
-- The guard skips when auth.uid() IS NULL so service_role / migrations / server jobs still work.
--
-- Self-contained: also re-declares SET search_path = public and locks EXECUTE to authenticated
-- (CREATE OR REPLACE resets both to PG defaults), so this migration is correct regardless of
-- ordering relative to 20260603_fix_security_advisor_part3.sql.
--
-- Behavior is otherwise unchanged: same columns, same per-item loop, same return type.
-- NOTE: this does NOT yet recompute totals server-side (totals are still client-supplied).
--       Server-authoritative money is a separate, larger change.
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
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
  v_address_id UUID;
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

    -- use provided created_at if exists, else now()
    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());

    INSERT INTO orders (total, total_cost, discount_amount, payment_method, address_id, staff_name, created_at)
    VALUES (
      (order_rec->>'total')::INTEGER,
      COALESCE((order_rec->>'total_cost')::INTEGER, 0),
      COALESCE((order_rec->>'discount_amount')::INTEGER, 0),
      order_rec->>'payment_method',
      v_address_id,
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

REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) TO authenticated;

COMMIT;
