-- Add soft delete columns to orders table
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by TEXT DEFAULT NULL;

-- Update get_today_stats to ignore deleted orders
CREATE OR REPLACE FUNCTION get_today_stats(p_address_id UUID)
RETURNS TABLE(revenue BIGINT, cups BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE((
      SELECT SUM(o.total)
      FROM orders o
      WHERE o.address_id = p_address_id
        AND o.deleted_at IS NULL
        AND o.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                            AT TIME ZONE 'Asia/Ho_Chi_Minh'
    ), 0)::BIGINT AS revenue,
    COALESCE((
      SELECT SUM(CASE WHEN p.count_as_cup IS DISTINCT FROM FALSE THEN oi.quantity ELSE 0 END)
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.address_id = p_address_id
        AND o.deleted_at IS NULL
        AND o.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                            AT TIME ZONE 'Asia/Ho_Chi_Minh'
    ), 0)::BIGINT AS cups;
$$;

-- Update get_branches_today_stats to ignore deleted orders
CREATE OR REPLACE FUNCTION get_branches_today_stats(p_address_ids UUID[])
RETURNS TABLE(address_id UUID, revenue BIGINT, cups BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH day_start AS (
    SELECT (date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
            AT TIME ZONE 'Asia/Ho_Chi_Minh') AS ts
  ),
  rev AS (
    SELECT o.address_id, COALESCE(SUM(o.total), 0)::BIGINT AS revenue
    FROM orders o
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= (SELECT ts FROM day_start)
    GROUP BY o.address_id
  ),
  cups AS (
    SELECT o.address_id, COALESCE(SUM(
      CASE WHEN p.count_as_cup IS DISTINCT FROM FALSE THEN oi.quantity ELSE 0 END
    ), 0)::BIGINT AS cups
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= (SELECT ts FROM day_start)
    GROUP BY o.address_id
  )
  SELECT rev.address_id, rev.revenue, COALESCE(cups.cups, 0)::BIGINT
  FROM rev
  LEFT JOIN cups ON cups.address_id = rev.address_id;
$$;
