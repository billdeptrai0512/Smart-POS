-- ============================================================
-- Guest onboarding funnel v2 — 2 yêu cầu:
-- 1. Tách phễu theo hôm nay / tuần này / tất cả thời gian — hiện chỉ có 1 con
--    số cộng dồn từ đầu, không khoanh vùng được khách để phỏng vấn.
-- 2. Biết mỗi bước tốn bao lâu (không chỉ bao nhiêu người xong) — để biết chỗ
--    nào trong guide đáng cải thiện trước.
--
-- guest_onboarding_funnel (bảng cũ) chỉ giữ max_stage — biết ĐÃ xong tới đâu,
-- không biết XONG LÚC NÀO (last_seen_at bị ghi đè ở MỌI lần gọi, không phải
-- mốc riêng từng stage). Giữ nguyên bảng cũ làm nguồn đếm phễu (không đổi
-- hành vi đã có) — thêm bảng event log riêng chỉ để tính thời gian.
--
-- track_guest_onboarding_stage() backfill mọi stage từ 0 → p_stage chưa có
-- event, không chỉ đúng p_stage: OnboardingGuide.jsx chỉ gọi khi stageReached
-- ĐỔI so với lần render trước — tải lại trang sau khi đã âm thầm xong nhiều
-- bước cùng lúc (state cục bộ) có thể "nhảy cóc" thẳng 0 → 4 mà không có lệnh
-- gọi riêng cho 1/2/3. Backfill gán cùng now() cho các mốc bị nhảy — không
-- biết chính xác lúc nào, nhưng trung thực hơn để trống (để trống thì mất
-- luôn dữ liệu thời gian của cả chuỗi phía sau vì self-join cần đủ 2 đầu mút).
--
-- guest_onboarding_funnel_stats() đổi RETURN SHAPE: bọc 3 lần (today/week/all)
-- trong 1 lần gọi thay vì thêm tham số — client đổi tab KHÔNG cần round-trip
-- mới. Giữ nguyên signature 0 tham số → KHÔNG cần REVOKE/GRANT lại (quy ước
-- CLAUDE.md chỉ áp dụng khi đổi signature).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS guest_onboarding_funnel_events (
    visitor_id  UUID NOT NULL,
    stage       SMALLINT NOT NULL CHECK (stage BETWEEN 0 AND 6),
    reached_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (visitor_id, stage)
);

-- RLS bật, không policy nào → deny toàn bộ truy cập trực tiếp, giống bảng
-- guest_onboarding_funnel gốc. Lối vào duy nhất qua 2 RPC SECURITY DEFINER dưới.
ALTER TABLE guest_onboarding_funnel_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION track_guest_onboarding_stage(p_visitor_id UUID, p_stage SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_visitor_id IS NULL OR p_stage IS NULL OR p_stage < 0 OR p_stage > 6 THEN
        RETURN;
    END IF;

    INSERT INTO guest_onboarding_funnel (visitor_id, max_stage, first_seen_at, last_seen_at)
    VALUES (p_visitor_id, p_stage, now(), now())
    ON CONFLICT (visitor_id) DO UPDATE
        SET max_stage    = GREATEST(guest_onboarding_funnel.max_stage, EXCLUDED.max_stage),
            last_seen_at = now();

    -- v2: backfill event cho mọi stage từ 0 tới p_stage chưa từng ghi (xem lý do
    -- "nhảy cóc" ở đầu file). Không đụng phễu đếm — vẫn dựa max_stage như cũ.
    INSERT INTO guest_onboarding_funnel_events (visitor_id, stage, reached_at)
    SELECT p_visitor_id, s, now()
    FROM generate_series(0, p_stage) AS s
    ON CONFLICT (visitor_id, stage) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION track_guest_onboarding_stage(UUID, SMALLINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION track_guest_onboarding_stage(UUID, SMALLINT) TO anon, authenticated;

-- ─── Đọc (admin): bọc theo 3 khoảng thời gian trong 1 lần gọi ─────────────
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
                    'step_median_minutes', (
                        SELECT ROUND(EXTRACT(EPOCH FROM
                            percentile_cont(0.5) WITHIN GROUP (ORDER BY e_now.reached_at - e_prev.reached_at)
                        ) / 60)
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
            'total_median_minutes', (
                SELECT ROUND(EXTRACT(EPOCH FROM
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY e6.reached_at - e0.reached_at)
                ) / 60)
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

REVOKE EXECUTE ON FUNCTION guest_onboarding_funnel_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guest_onboarding_funnel_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION guest_onboarding_funnel_stats() TO authenticated;

COMMIT;
