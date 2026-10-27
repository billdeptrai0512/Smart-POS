-- ==============================================================================================
-- Mốc "mở trang đăng ký" của phễu dùng thử. Phễu hiện có điểm đầu (bấm "Dùng thử miễn phí") và
-- điểm cuối (đăng ký xong) nhưng không biết khách rơi ở form đăng ký hay rơi trước đó.
--
-- Mirror login_page_visits (20261024): bảng riêng PK (visitor_id, visit_day) — 1 dòng/trình
-- duyệt/ngày giờ VN, không đụng guest_onboarding_funnel (CHECK 0..6 + 8 đời stats). visitor_id
-- dùng chung localStorage key với phễu; chỉ máy ĐÃ có id (từng ghé /login hoặc dùng thử) mới ghi —
-- người đăng ký thẳng không có id nên không bị đếm như khách dùng thử.
--
-- login_page_visit_stats() v4: thêm today_signup/week_signup/all_signup = số trình duyệt ĐÃ dùng
-- thử (có dòng trong guest_onboarding_funnel) và mở trang đăng ký trong khoảng. Giữ nguyên các
-- key cũ → CREATE OR REPLACE, khai lại search_path + guard admin + REVOKE/GRANT.
-- Client chịu được cả khi chưa apply: ghi là fire-and-forget, đọc thiếu key thì dashboard ẩn dòng.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS signup_page_visits (
    visitor_id UUID NOT NULL,
    visit_day  DATE NOT NULL,
    PRIMARY KEY (visitor_id, visit_day)
);

ALTER TABLE signup_page_visits ENABLE ROW LEVEL SECURITY;

-- Ghi (anon + authenticated, cùng lý do như track_login_page_visit). Chỉ chèn được 1 dòng
-- (UUID, hôm nay), trùng thì bỏ qua.
CREATE OR REPLACE FUNCTION track_signup_page_visit(p_visitor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_visitor_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO signup_page_visits (visitor_id, visit_day)
    VALUES (p_visitor_id, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION track_signup_page_visit(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION track_signup_page_visit(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION login_page_visit_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    v_week  DATE := date_trunc('week', v_today)::date;
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard';
    END IF;

    RETURN (
        WITH v AS (
            SELECT lv.visitor_id, lv.visit_day,
                   (EXISTS (SELECT 1 FROM login_page_members m WHERE m.visitor_id = lv.visitor_id)
                    AND NOT EXISTS (SELECT 1 FROM guest_onboarding_funnel g WHERE g.visitor_id = lv.visitor_id)) AS is_member
            FROM login_page_visits lv
        ),
        s AS (
            SELECT sv.visitor_id, sv.visit_day
            FROM signup_page_visits sv
            WHERE EXISTS (SELECT 1 FROM guest_onboarding_funnel g WHERE g.visitor_id = sv.visitor_id)
        )
        SELECT jsonb_build_object(
            'today',         (SELECT COUNT(DISTINCT visitor_id) FROM v WHERE NOT is_member AND visit_day >= v_today),
            'week',          (SELECT COUNT(DISTINCT visitor_id) FROM v WHERE NOT is_member AND visit_day >= v_week),
            'all',           (SELECT COUNT(DISTINCT visitor_id) FROM v WHERE NOT is_member),
            'today_members', (SELECT COUNT(DISTINCT visitor_id) FROM v WHERE is_member AND visit_day >= v_today),
            'week_members',  (SELECT COUNT(DISTINCT visitor_id) FROM v WHERE is_member AND visit_day >= v_week),
            'all_members',   (SELECT COUNT(DISTINCT visitor_id) FROM v WHERE is_member),
            'today_signup',  (SELECT COUNT(DISTINCT visitor_id) FROM s WHERE visit_day >= v_today),
            'week_signup',   (SELECT COUNT(DISTINCT visitor_id) FROM s WHERE visit_day >= v_week),
            'all_signup',    (SELECT COUNT(DISTINCT visitor_id) FROM s)
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION login_page_visit_stats() TO authenticated;

COMMIT;
