-- ============================================================
-- Funnel onboarding: đổi step_median_minutes/total_median_minutes (làm tròn
-- phút) sang step_median_seconds/total_median_seconds (giây thô, không làm
-- tròn). Các bước trong guide (bấm tạo đơn, mở nhật ký...) đều ở tầm giây,
-- ROUND(.../60) trước đây làm mọi bước hiện "0 phút" như nhau — mất hết tín
-- hiệu bước nào chậm hơn bước nào. Client tự format giây/phút cho phù hợp.
--
-- Chỉ đổi 2 field JSON trả về, KHÔNG đổi signature (vẫn 0 tham số) → không
-- cần REVOKE/GRANT lại, theo đúng quy ước đã ghi ở 20260816_guest_onboarding_
-- funnel_v2.sql. Guard admin-only giữ nguyên.
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
                    -- Giây thô, không /60 — các bước này tầm giây, làm tròn phút mất hết tín hiệu.
                    'step_median_seconds', (
                        SELECT ROUND(EXTRACT(EPOCH FROM
                            percentile_cont(0.5) WITHIN GROUP (ORDER BY e_now.reached_at - e_prev.reached_at)
                        ))
                        FROM guest_onboarding_funnel_events e_now
                        JOIN guest_onboarding_funnel_events e_prev
                            ON e_prev.visitor_id = e_now.visitor_id AND e_prev.stage = gs.stage - 1
                        WHERE e_now.stage = gs.stage AND gs.stage > 0
                          AND e_now.reached_at >= r.since
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

-- Signature không đổi (0 tham số) nên EXECUTE grant hiện có (authenticated only,
-- REVOKE khỏi PUBLIC/anon) không bị PostgreSQL rơi mất — không cần REVOKE/GRANT lại.

COMMIT;
