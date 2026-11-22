-- admin_ops_health(): vài con số SỨC KHOẺ VẬN HÀNH đo được từ chính DB production, cho thẻ ở /admin/dashboard.
-- Chỉ đọc, rẻ (đều lọc theo ngày/status có index). Không có ownership guard theo chi nhánh vì đây là hàm admin toàn hệ thống —
-- guard là is_admin_auth (cùng admin_branch_stages). Hàm mới → search_path + REVOKE PUBLIC/anon + GRANT authenticated.
--   orders_by_day     : số đơn (chưa xoá) 7 ngày gần nhất theo ngày VN, cũ → mới (xu hướng tải)
--   orders_today      : đơn hôm nay; last_order_at: đơn mới nhất toàn hệ thống (im lặng bất thường = dấu hiệu sự cố)
--   deleted_rate_7d   : % đơn bị xoá trong 7 ngày (tăng đột biến = nhân viên sửa/huỷ nhiều bất thường)
--   intents_stuck     : payment_intents 'pending' đã quá hạn > 1 giờ mà chưa được cron dọn (cron hourly hỏng?)
--   intents_review    : payment_intents 'manual_review' chờ admin xử lý
--   unclosed_yesterday: số chi nhánh có đơn hôm qua nhưng KHÔNG có phiếu kết ca hôm qua
CREATE OR REPLACE FUNCTION admin_ops_health()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := vn_business_date(now());
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN (
        WITH recent AS (
            SELECT address_id, created_at, deleted_at, vn_business_date(created_at) AS d
            FROM orders
            WHERE created_at >= (v_today - 7)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'
        ),
        days AS (
            SELECT g::date AS d FROM generate_series(v_today - 6, v_today, interval '1 day') g
        ),
        by_day AS (
            SELECT days.d, COUNT(r.address_id) FILTER (WHERE r.deleted_at IS NULL) AS n
            FROM days LEFT JOIN recent r ON r.d = days.d
            GROUP BY days.d
        )
        SELECT jsonb_build_object(
            'orders_by_day',      (SELECT jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d) FROM by_day),
            'orders_today',       (SELECT COUNT(*) FROM recent WHERE d = v_today AND deleted_at IS NULL),
            'last_order_at',      (SELECT MAX(created_at) FROM orders WHERE deleted_at IS NULL AND created_at >= now() - interval '7 days'),
            'deleted_rate_7d',    (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1) FROM recent),
            'intents_stuck',      (SELECT COUNT(*) FROM payment_intents WHERE status = 'pending' AND expires_at < now() - interval '1 hour'),
            'intents_review',     (SELECT COUNT(*) FROM payment_intents WHERE status = 'manual_review'),
            'unclosed_yesterday', (SELECT COUNT(*) FROM (SELECT DISTINCT address_id FROM recent WHERE d = v_today - 1 AND deleted_at IS NULL) y
                                    WHERE NOT EXISTS (SELECT 1 FROM shift_closings sc
                                                      WHERE sc.address_id = y.address_id AND vn_business_date(sc.closed_at) = v_today - 1))
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_ops_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_ops_health() TO authenticated;
