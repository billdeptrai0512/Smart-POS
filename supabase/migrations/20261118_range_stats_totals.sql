-- get_range_stats_totals: tổng ly + doanh thu của p_days ngày gần nhất (gồm hôm nay) cho thẻ tổng
-- ở trang /addresses (pill lọc Hôm nay / 7 ngày / 30 ngày), kèm kỳ liền trước cùng độ dài để tính %.
--   cur  = [00:00 VN của (p_days-1) ngày trước, NOW()]
--   prev = [cur_start - p_days ngày, NOW() - p_days ngày)   ← cùng quy ước "đến cùng giờ" với get_branches_today_stats
-- Hàm MỚI (signature mới) → SET search_path + REVOKE PUBLIC/anon + GRANT authenticated.
-- SECURITY INVOKER: RLS trên orders/order_items/products là lớp chặn, không có ownership guard trong body.

CREATE OR REPLACE FUNCTION get_range_stats_totals(p_address_ids UUID[], p_days INT)
RETURNS TABLE(revenue BIGINT, cups BIGINT, prev_revenue BIGINT, prev_cups BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH b AS (
    SELECT (date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')
             - make_interval(days => GREATEST(p_days, 1) - 1) AS cur_start,
           GREATEST(p_days, 1) AS n
  ),
  o AS MATERIALIZED (
    SELECT o.id, o.total, (o.created_at >= b.cur_start) AS is_cur
    FROM orders o, b
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= b.cur_start - make_interval(days => b.n)
      AND (o.created_at >= b.cur_start OR o.created_at < NOW() - make_interval(days => b.n))
  ),
  rev AS (
    SELECT COALESCE(SUM(total) FILTER (WHERE is_cur), 0)::BIGINT AS revenue,
           COALESCE(SUM(total) FILTER (WHERE NOT is_cur), 0)::BIGINT AS prev_revenue
    FROM o
  ),
  cup AS (
    SELECT COALESCE(SUM(oi.quantity) FILTER (WHERE o.is_cur AND p.count_as_cup IS DISTINCT FROM FALSE), 0)::BIGINT AS cups,
           COALESCE(SUM(oi.quantity) FILTER (WHERE NOT o.is_cur AND p.count_as_cup IS DISTINCT FROM FALSE), 0)::BIGINT AS prev_cups
    FROM o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
  )
  SELECT rev.revenue, cup.cups, rev.prev_revenue, cup.prev_cups FROM rev, cup;
$$;

REVOKE EXECUTE ON FUNCTION get_range_stats_totals(UUID[], INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_range_stats_totals(UUID[], INT) TO authenticated;
