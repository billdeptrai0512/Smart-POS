-- ============================================================
-- Guide khách dùng thử đổi sang kịch bản "một ngày của quán" — 6 bước (src/components/common/onboarding/steps.ts):
--   1 Chuẩn bị (lấy hàng từ kho ra quầy) → 2 Bán 1 đơn (app tự sinh cả ngày bán) → 3 Nhật ký → 4 Kết ca
--   → 5 Kiểm kê → 6 Bổ sung tồn kho. Bỏ bước Công thức.
-- guest_onboarding_funnel_stats(): nhãn mốc 1..6 theo thứ tự mới, generate_series(0,6), "xong hết guide" =
-- max_stage >= 6, thời gian trung vị cả phễu theo sự kiện stage 6. Client (AdminDashboardPage.tsx) bỏ bảng đảo
-- nhãn 3/4 cũ.
-- ⚠ Nhãn gắn theo VỊ TRÍ nên khách cũ (guide 5 bước, đến 10/11/2026) bị đọc theo nghĩa mới — xem phễu theo
--   "Hôm nay"/"Tuần này" sau khi deploy để có số sạch.
-- track_guest_onboarding_stage() KHÔNG đổi: CHECK 0..6 đã đủ cho 6 bước.
--
-- Signature không đổi (0 tham số) → giữ nguyên GRANT/REVOKE cũ. SET search_path và ownership guard
-- (is_admin_auth) khai báo lại đầy đủ — CREATE OR REPLACE làm rơi search_path nếu quên.
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
                        WHEN 1 THEN 'Xong: Lấy hàng ra quầy'
                        WHEN 2 THEN 'Xong: Bán 1 đơn'
                        WHEN 3 THEN 'Xong: Nhật ký'
                        WHEN 4 THEN 'Xong: Kết ca đếm tiền'
                        WHEN 5 THEN 'Xong: Kiểm kê tồn kho'
                        WHEN 6 THEN 'Xong: Bổ sung tồn kho'
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
                    'after_complete', COUNT(*) FILTER (WHERE max_stage >= 6),
                    'early',          COUNT(*) FILTER (WHERE max_stage < 6)
                )
                FROM guest_onboarding_funnel WHERE signed_up_at IS NOT NULL AND first_seen_at >= r.since
            ),
            -- Tổng thời gian trung vị hoàn thành CẢ phễu (stage 0 → 6), chỉ tính người xong hết.
            'total_median_seconds', (
                SELECT ROUND(EXTRACT(EPOCH FROM
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY e_end.reached_at - e0.reached_at)
                ))
                FROM guest_onboarding_funnel_events e0
                JOIN guest_onboarding_funnel_events e_end
                    ON e_end.visitor_id = e0.visitor_id AND e_end.stage = 6
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
