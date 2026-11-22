-- get_range_stats_totals v2: nhận khoảng ngày tuỳ chọn [p_start, p_end] (giờ VN, gồm cả 2 đầu) thay vì "p_days ngày gần nhất",
-- cho thẻ tổng ở /addresses khi chọn lịch range. Kèm kỳ liền trước cùng độ dài (n = số ngày của kỳ) để tính %.
--   cur  = [00:00 VN của p_start, LEAST(00:00 VN của p_end+1, NOW()))
--   prev = [cur_start - n ngày, cur_end - n ngày)   ← kỳ kết thúc hôm nay thì "đến cùng giờ" như get_branches_today_stats
-- Signature mới → xoá bản (UUID[], INT) cũ + SET search_path + REVOKE PUBLIC/anon + GRANT authenticated.
-- SECURITY INVOKER: RLS trên orders/order_items/products là lớp chặn, không có ownership guard trong body.

DROP FUNCTION IF EXISTS get_range_stats_totals(UUID[], INT);

CREATE OR REPLACE FUNCTION get_range_stats_totals(p_address_ids UUID[], p_start DATE, p_end DATE)
RETURNS TABLE(revenue BIGINT, cups BIGINT, prev_revenue BIGINT, prev_cups BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH w AS (
    SELECT cur_start, cur_end,
           cur_start - make_interval(days => n) AS prev_start,
           cur_end - make_interval(days => n) AS prev_end
    FROM (
      SELECT (p_start::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS cur_start,
             LEAST(((p_end + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'), NOW()) AS cur_end,
             (p_end - p_start + 1) AS n
    ) b
  ),
  o AS MATERIALIZED (
    SELECT o.id, o.total, (o.created_at >= w.cur_start) AS is_cur
    FROM orders o, w
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= w.prev_start
      AND o.created_at < w.cur_end
      AND (o.created_at >= w.cur_start OR o.created_at < w.prev_end)
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

REVOKE EXECUTE ON FUNCTION get_range_stats_totals(UUID[], DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_range_stats_totals(UUID[], DATE, DATE) TO authenticated;
