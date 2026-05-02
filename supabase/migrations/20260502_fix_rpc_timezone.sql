-- Fix day boundary in aggregate RPCs: use Vietnam timezone (UTC+7) instead of
-- UTC so orders placed before 07:00 VN time are correctly included in today's
-- stats. date_trunc('day', NOW()) was resolving to UTC midnight = 07:00 VN.

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
    AND o.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
$$;

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
    AND o.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'
  GROUP BY o.address_id;
$$;

GRANT EXECUTE ON FUNCTION get_today_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_branches_today_stats(UUID[]) TO authenticated;
