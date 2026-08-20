-- ============================================================
-- Thêm so sánh với kỳ liền trước (hôm qua / tuần trước) cho tỷ lệ chuyển đổi
-- dùng thử → đăng ký — hiện tại funnel chỉ là ảnh chụp 1 thời điểm, không biết
-- sửa guide tuần trước có thật sự giúp tăng tỷ lệ hay chỉ là 1-2 khách ngẫu
-- nhiên đi nhanh/chậm. 'all' không có "kỳ trước" tự nhiên nên trả prev = NULL,
-- client tự ẩn phần so sánh.
--
-- Chỉ thêm COUNT có khoảng chặn trên/dưới trên bảng đã có sẵn (guest_onboarding_
-- funnel), không JOIN gì thêm — rẻ.
--
-- Signature không đổi (0 tham số) → không cần REVOKE/GRANT lại.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION guest_onboarding_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard';
    END IF;

    RETURN (
        SELECT jsonb_object_agg(r.range_key, jsonb_build_object(
            'stages', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'stage', gs.stage,
                    'label', CASE gs.stage
                        WHEN 0 THEN 'Vào dùng thử'
                        WHEN 1 THEN 'Xong: Bấm tạo đơn'
                        WHEN 2 THEN 'Xong: Nhật ký'
                        WHEN 3 THEN 'Xong: Kết ca đếm tiền'
                        WHEN 4 THEN 'Xong: Kiểm kê tồn kho'
                        WHEN 5 THEN 'Xong: Cài công thức'
                        WHEN 6 THEN 'Xong: Cài đặt nguyên liệu (hết guide)'
                    END,
                    'count', (
                        SELECT COUNT(*) FROM guest_onboarding_funnel f
                        WHERE f.max_stage >= gs.stage AND f.first_seen_at >= r.since
                    ),
                    -- Thời gian trung vị TỪ BƯỚC NGAY TRƯỚC tới bước này — median chứ không
                    -- avg vì phân phối lệch mạnh (có người bỏ tab rồi quay lại giữa chừng).
                    -- Lọc theo first_seen_at (join guest_onboarding_funnel) — cùng cohort với
                    -- `count` ở trên, không lấy theo reached_at của chính bước này.
                    'step_median_seconds', (
                        SELECT ROUND(EXTRACT(EPOCH FROM
                            percentile_cont(0.5) WITHIN GROUP (ORDER BY e_now.reached_at - e_prev.reached_at)
                        ))
                        FROM guest_onboarding_funnel_events e_now
                        JOIN guest_onboarding_funnel_events e_prev
                            ON e_prev.visitor_id = e_now.visitor_id AND e_prev.stage = gs.stage - 1
                        JOIN guest_onboarding_funnel fv ON fv.visitor_id = e_now.visitor_id
                        WHERE e_now.stage = gs.stage AND gs.stage > 0
                          AND fv.first_seen_at >= r.since
                    )
                ) ORDER BY gs.stage), '[]'::jsonb)
                FROM generate_series(0, 6) AS gs(stage)
            ),
            'signup', (
                SELECT jsonb_build_object(
                    'after_complete', COUNT(*) FILTER (WHERE max_stage = 6),
                    'early',          COUNT(*) FILTER (WHERE max_stage < 6)
                )
                FROM guest_onboarding_funnel WHERE signed_up_at IS NOT NULL AND first_seen_at >= r.since
            ),
            -- Tổng thời gian trung vị hoàn thành CẢ phễu (stage 0 → 6), chỉ tính người xong hết.
            'total_median_seconds', (
                SELECT ROUND(EXTRACT(EPOCH FROM
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY e6.reached_at - e0.reached_at)
                ))
                FROM guest_onboarding_funnel_events e0
                JOIN guest_onboarding_funnel_events e6
                    ON e6.visitor_id = e0.visitor_id AND e6.stage = 6
                WHERE e0.stage = 0 AND e0.reached_at >= r.since
            ),
            -- Danh sách thô, không gộp — mới hoạt động gần nhất trước, tối đa 20 dòng.
            'recent_visitors', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'visitor_id', v.visitor_id,
                    'max_stage', v.max_stage,
                    'first_seen_at', v.first_seen_at,
                    'last_seen_at', v.last_seen_at,
                    'signed_up_at', v.signed_up_at
                ) ORDER BY v.last_seen_at DESC), '[]'::jsonb)
                FROM (
                    SELECT visitor_id, max_stage, first_seen_at, last_seen_at, signed_up_at
                    FROM guest_onboarding_funnel
                    WHERE first_seen_at >= r.since
                    ORDER BY last_seen_at DESC
                    LIMIT 20
                ) v
            ),
            -- Kỳ liền trước (hôm qua / tuần trước), chỉ 2 số đủ tính % chuyển đổi để so
            -- sánh — không lặp lại toàn bộ stages cho kỳ trước, tốn mà ít khi cần soi chi
            -- tiết kỳ đã qua. 'all' không có kỳ trước tự nhiên → since_prev NULL → prev NULL.
            'prev', CASE WHEN r.since_prev IS NULL THEN NULL ELSE (
                SELECT jsonb_build_object(
                    'entered',   COUNT(*),
                    'signed_up', COUNT(*) FILTER (WHERE signed_up_at IS NOT NULL)
                )
                FROM guest_onboarding_funnel
                WHERE first_seen_at >= r.since_prev AND first_seen_at < r.until_prev
            ) END
        ))
        FROM (VALUES
            ('today', date_trunc('day',  now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                      (date_trunc('day',  now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                      date_trunc('day',  now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
            ('week',  date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                      (date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - interval '7 days') AT TIME ZONE 'Asia/Ho_Chi_Minh',
                      date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
            ('all',   '-infinity'::timestamptz, NULL::timestamptz, NULL::timestamptz)
        ) AS r(range_key, since, since_prev, until_prev)
    );
END;
$$;

COMMIT;
