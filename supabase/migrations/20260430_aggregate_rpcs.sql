-- =============================================
-- Aggregate RPCs to replace heavy "fetch all + sum on client" reads
-- =============================================
-- These functions push aggregation into Postgres so the wire payload becomes
-- a single row instead of every order + every order_item joined to products.
--
-- Both functions are SECURITY INVOKER, so the existing RLS policies on
-- `orders`, `order_items`, and `products` continue to apply unchanged. A
-- caller can only see aggregates over rows they were already allowed to read.
--
-- Safe to run multiple times: CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- get_today_stats(p_address_id)
-- Replaces fetchTodayStats(addressId) — used by POSContext on every order
-- INSERT (debounced) + page load.
-- Returns: { revenue, cups } for today (since 00:00 local server time).
--
-- "cups" sums order_items.quantity for items whose product has
-- count_as_cup IS NOT FALSE (matches existing client logic — both NULL and
-- TRUE count, only explicit FALSE excludes).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_today_stats(p_address_id UUID)
RETURNS TABLE(revenue BIGINT, cups BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(o.total), 0)::BIGINT AS revenue,
    COALESCE(SUM(
      CASE WHEN p.count_as_cup IS DISTINCT FROM FALSE THEN oi.quantity ELSE 0 END
    ), 0)::BIGINT AS cups
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE o.address_id = p_address_id
    AND o.created_at >= date_trunc('day', NOW());
$$;

-- ---------------------------------------------------------------------------
-- get_branches_today_stats(p_address_ids)
-- Replaces fetchBranchTodayCups + fetchBranchTodayRevenue — used by
-- AddressSelectPage to render per-branch tiles. Combines two queries into
-- one call that returns a row per requested address.
--
-- Addresses with no orders today are NOT returned (caller should default to
-- 0). Match the existing client behavior where unseen ids stay missing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_branches_today_stats(p_address_ids UUID[])
RETURNS TABLE(address_id UUID, revenue BIGINT, cups BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    o.address_id,
    COALESCE(SUM(o.total), 0)::BIGINT AS revenue,
    COALESCE(SUM(
      CASE WHEN p.count_as_cup IS DISTINCT FROM FALSE THEN oi.quantity ELSE 0 END
    ), 0)::BIGINT AS cups
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE o.address_id = ANY(p_address_ids)
    AND o.created_at >= date_trunc('day', NOW())
  GROUP BY o.address_id;
$$;

-- Allow authenticated users to call these RPCs (RLS still applies inside)
GRANT EXECUTE ON FUNCTION get_today_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_branches_today_stats(UUID[]) TO authenticated;
