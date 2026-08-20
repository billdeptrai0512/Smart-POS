-- ============================================================
-- step_median_seconds đang lọc theo mốc SAI so với `count` cùng dòng: count
-- tính khách có first_seen_at (lúc VÀO funnel) nằm trong khoảng đang chọn,
-- còn step_median_seconds lọc theo reached_at CỦA ĐÚNG BƯỚC ĐÓ — hai mốc
-- khác nhau với khách vào từ khoảng trước rồi quay lại đi tiếp trong khoảng
-- này. Kết quả: 1 bước hiện "0 (0%)" (không khách nào của cohort này tới)
-- nhưng vẫn kèm số giây (của khách cohort khác) — 2 con số cùng dòng mô tả
-- 2 nhóm khách khác nhau, đọc vào dễ hiểu nhầm là khách đi qua bước mà
-- không tính vào phễu.
--
-- Fix: join thêm guest_onboarding_funnel, lọc step_median_seconds theo
-- first_seen_at — cùng cohort với count. (total_median_seconds không dính
-- lỗi này: stage 0's reached_at luôn trùng first_seen_at, xem
-- track_guest_onboarding_stage — nên giữ nguyên, không đổi.)
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
                    -- Lọc theo first_seen_at (join guest_onboarding_funnel) chứ không phải
                    -- reached_at của chính bước này — phải CÙNG cohort với `count` ở trên,
                    -- không thì 1 bước có thể hiện count=0 nhưng vẫn có số giây của khách
                    -- thuộc cohort khác (vào từ khoảng trước, quay lại đi tiếp trong khoảng này).
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
            )
        ))
        FROM (VALUES
            ('today', date_trunc('day',  now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
            ('week',  date_trunc('week', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'),
            ('all',   '-infinity'::timestamptz)
        ) AS r(range_key, since)
    );
END;
$$;

COMMIT;
