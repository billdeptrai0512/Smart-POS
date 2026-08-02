-- get_branches_today_stats: gộp 4 lần quét orders thành 1
-- =============================================
-- Đo trên tài khoản 14 chi nhánh (/addresses, lần load đầu): RPC này tốn ~1.14s,
-- chiếm hơn nửa thời gian tới lúc card đủ số — nút thắt lớn nhất còn lại sau khi
-- đã dẹp các lần refetch trùng ở client.
--
-- Bản cũ (20260703) có 4 CTE quét orders trên cùng dải 2 ngày: rev + cups cho hôm
-- nay, prev_rev + prev_cup cho hôm qua; order_items bị join 2 lần. Index đã đủ
-- (idx_orders_address_created) nên chi phí nằm ở SỐ LẦN quét × RLS SECURITY INVOKER
-- phải chạy lại trên từng row mỗi lần.
--
-- Giờ: 1 CTE `o` quét orders đúng 1 lần (AS MATERIALIZED để Postgres không inline
-- rồi quét lại ở mỗi nơi tham chiếu), gắn cờ is_today; hôm nay/hôm qua tách bằng
-- SUM(...) FILTER trong cùng một pass. order_items join 1 lần thay vì 2.
--
-- Kết quả trả về KHÔNG đổi (cùng cột, cùng ngữ nghĩa cửa sổ thời gian):
--   today = created_at >= 00:00 VN hôm nay
--   prev  = [00:00 VN hôm qua, NOW() - 24h)  ← "hôm qua tính đến cùng giờ này"
-- SUM(CASE WHEN count_as_cup ... ELSE 0 END) đổi thành SUM(...) FILTER: row bị loại
-- thay vì cộng 0 → cùng số, chỉ khác khi KHÔNG có row nào (NULL) và COALESCE đã lo.
--
-- Return type giữ nguyên → CREATE OR REPLACE, không cần DROP.
-- Theo CLAUDE.md: khai lại SET search_path (REPLACE làm rơi) và nhắc lại REVOKE/GRANT.
-- SECURITY INVOKER giữ nguyên — RLS trên orders/order_items/products/active_sessions
-- vẫn là lớp chặn, không có ownership guard nào trong body để giữ.

CREATE OR REPLACE FUNCTION get_branches_today_stats(p_address_ids UUID[])
RETURNS TABLE(address_id UUID, revenue BIGINT, cups BIGINT, prev_revenue BIGINT, prev_cups BIGINT, sessions JSONB)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH day_start AS (
    SELECT (date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
            AT TIME ZONE 'Asia/Ho_Chi_Minh') AS ts
  ),
  ids AS (
    SELECT unnest(p_address_ids) AS address_id
  ),
  -- 1 lần quét orders cho CẢ hôm nay lẫn hôm qua. MATERIALIZED: CTE này được tham
  -- chiếu 2 nơi (rev, cup) — không ghim thì Postgres có thể inline và quét lại.
  o AS MATERIALIZED (
    SELECT o.id,
           o.address_id,
           o.total,
           (o.created_at >= (SELECT ts FROM day_start)) AS is_today
    FROM orders o
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= (SELECT ts FROM day_start) - INTERVAL '1 day'
      AND (o.created_at >= (SELECT ts FROM day_start)
           OR o.created_at < NOW() - INTERVAL '24 hours')
  ),
  rev AS (
    SELECT o.address_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.is_today), 0)::BIGINT AS revenue,
           COALESCE(SUM(o.total) FILTER (WHERE NOT o.is_today), 0)::BIGINT AS prev_revenue
    FROM o
    GROUP BY o.address_id
  ),
  cup AS (
    SELECT o.address_id,
           COALESCE(SUM(oi.quantity) FILTER (
             WHERE o.is_today AND p.count_as_cup IS DISTINCT FROM FALSE
           ), 0)::BIGINT AS cups,
           COALESCE(SUM(oi.quantity) FILTER (
             WHERE NOT o.is_today AND p.count_as_cup IS DISTINCT FROM FALSE
           ), 0)::BIGINT AS prev_cups
    FROM o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    GROUP BY o.address_id
  ),
  sess AS (
    -- Cùng cutoff 10 phút với fetchActiveSessions phía client
    SELECT s.address_id,
           jsonb_agg(jsonb_build_object('name', u.name, 'role', u.role)) AS sessions
    FROM active_sessions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.address_id = ANY(p_address_ids)
      AND s.last_seen >= NOW() - INTERVAL '10 minutes'
    GROUP BY s.address_id
  )
  SELECT ids.address_id,
         COALESCE(rev.revenue, 0)::BIGINT AS revenue,
         COALESCE(cup.cups, 0)::BIGINT AS cups,
         COALESCE(rev.prev_revenue, 0)::BIGINT AS prev_revenue,
         COALESCE(cup.prev_cups, 0)::BIGINT AS prev_cups,
         COALESCE(sess.sessions, '[]'::jsonb) AS sessions
  FROM ids
  LEFT JOIN rev ON rev.address_id = ids.address_id
  LEFT JOIN cup ON cup.address_id = ids.address_id
  LEFT JOIN sess ON sess.address_id = ids.address_id;
$$;

REVOKE EXECUTE ON FUNCTION get_branches_today_stats(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_branches_today_stats(UUID[]) TO authenticated;
