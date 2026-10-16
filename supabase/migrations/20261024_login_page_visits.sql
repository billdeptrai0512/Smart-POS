-- ==============================================================================================
-- Đầu phễu "sự chú ý": bao nhiêu trình duyệt ghé /login. Phễu onboarding hiện chỉ bắt đầu từ lúc
-- khách bấm "Hướng dẫn sử dụng" (stage 0) nên không tính được tỉ lệ ghé trang → bấm.
--
-- Bảng RIÊNG thay vì thêm stage -1 vào guest_onboarding_funnel: bảng đó có CHECK 0..6, bảng events,
-- generate_series và 8 đời guest_onboarding_funnel_stats() dựa vào stage >= 0 — không đụng.
-- PK (visitor_id, visit_day) = 1 dòng/trình duyệt/ngày (giờ VN) → đếm "người ghé hôm nay/tuần" đúng
-- kể cả khách ghé tuần trước nhưng bấm hôm nay (đếm theo first_seen_at sẽ làm % vượt 100).
-- visitor_id dùng chung localStorage key với phễu (onboardingFunnelService.ts) nên khớp được.
--
-- RLS bật, không policy → chỉ vào qua 2 hàm SECURITY DEFINER dưới đây.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS login_page_visits (
    visitor_id UUID NOT NULL,
    visit_day  DATE NOT NULL,
    PRIMARY KEY (visitor_id, visit_day)
);

ALTER TABLE login_page_visits ENABLE ROW LEVEL SECURITY;

-- Ghi (anon + authenticated, cùng lý do như track_guest_onboarding_stage: máy còn session cũ vẫn
-- phải ghi được). Chỉ chèn được 1 dòng (UUID, hôm nay), trùng thì bỏ qua.
CREATE OR REPLACE FUNCTION track_login_page_visit(p_visitor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_visitor_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO login_page_visits (visitor_id, visit_day)
    VALUES (p_visitor_id, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION track_login_page_visit(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION track_login_page_visit(UUID) TO anon, authenticated;

-- Đọc (admin): { today, week, all } = số trình duyệt phân biệt ghé /login trong khoảng.
CREATE OR REPLACE FUNCTION login_page_visit_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard';
    END IF;

    RETURN jsonb_build_object(
        'today', (SELECT COUNT(DISTINCT visitor_id) FROM login_page_visits WHERE visit_day >= v_today),
        'week',  (SELECT COUNT(DISTINCT visitor_id) FROM login_page_visits WHERE visit_day >= date_trunc('week', v_today)::date),
        'all',   (SELECT COUNT(DISTINCT visitor_id) FROM login_page_visits)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION login_page_visit_stats() TO authenticated;

COMMIT;
