-- Gộp active sessions (+ tên/role user) + so-với-hôm-qua vào get_branches_today_stats
-- =============================================
-- /addresses đang tốn 3 round-trip tuần tự lúc login: RPC stats → query
-- active_sessions → query users (lấy tên). Gộp cả 3 vào 1 RPC để skeleton
-- trên BranchGrid hiện ngắn lại.
--
-- Kèm prev_revenue/prev_cups = doanh thu/ly HÔM QUA TÍNH ĐẾN CÙNG GIỜ NÀY
-- (không phải cả ngày hôm qua — so cả ngày với nửa ngày thì delta vô nghĩa)
-- để card hiện "↑12% so với hôm qua". Batch vào cùng lần DROP+CREATE này vì
-- mỗi lần đổi return type là một lần ceremony REVOKE/GRANT.
--
-- Đổi return type (thêm cột sessions JSONB) → bắt buộc DROP + CREATE.
-- Theo CLAUDE.md: khai báo lại SET search_path + REVOKE/GRANT vì DROP làm rơi cả hai.
--
-- Sửa kèm: RPC cũ drive từ CTE rev nên địa chỉ không có đơn hôm nay bị RỖNG row
-- (client tự lấp 0). Giờ drive từ unnest(p_address_ids) để địa chỉ nào cũng có
-- row — sessions phải trả về cả cho quán chưa bán được ly nào.
--
-- SECURITY INVOKER giữ nguyên: RLS trên orders/active_sessions/users là ownership
-- guard — user chỉ thấy session/tên trong phạm vi team như 2 query rời trước đây
-- (không đọc được users thì name = null, client degrade thành 'Unknown').

DROP FUNCTION IF EXISTS get_branches_today_stats(UUID[]);

CREATE FUNCTION get_branches_today_stats(p_address_ids UUID[])
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
  ),
  -- Hôm qua, từ 00:00 VN đến "cùng giờ này" (NOW() - 24h; VN không có DST nên an toàn)
  prev_rev AS (
    SELECT o.address_id, COALESCE(SUM(o.total), 0)::BIGINT AS revenue
    FROM orders o
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= (SELECT ts FROM day_start) - INTERVAL '1 day'
      AND o.created_at < NOW() - INTERVAL '24 hours'
    GROUP BY o.address_id
  ),
  prev_cup AS (
    SELECT o.address_id, COALESCE(SUM(
      CASE WHEN p.count_as_cup IS DISTINCT FROM FALSE THEN oi.quantity ELSE 0 END
    ), 0)::BIGINT AS cups
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.address_id = ANY(p_address_ids)
      AND o.deleted_at IS NULL
      AND o.created_at >= (SELECT ts FROM day_start) - INTERVAL '1 day'
      AND o.created_at < NOW() - INTERVAL '24 hours'
    GROUP BY o.address_id
  ),
  sess AS (
    -- Cùng cutoff 10 phút với fetchActiveSessions phía client (đang bị thay thế)
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
         COALESCE(cups.cups, 0)::BIGINT AS cups,
         COALESCE(prev_rev.revenue, 0)::BIGINT AS prev_revenue,
         COALESCE(prev_cup.cups, 0)::BIGINT AS prev_cups,
         COALESCE(sess.sessions, '[]'::jsonb) AS sessions
  FROM ids
  LEFT JOIN rev ON rev.address_id = ids.address_id
  LEFT JOIN cups ON cups.address_id = ids.address_id
  LEFT JOIN prev_rev ON prev_rev.address_id = ids.address_id
  LEFT JOIN prev_cup ON prev_cup.address_id = ids.address_id
  LEFT JOIN sess ON sess.address_id = ids.address_id;
$$;

REVOKE EXECUTE ON FUNCTION get_branches_today_stats(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_branches_today_stats(UUID[]) TO authenticated;
