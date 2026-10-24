-- ==============================================================================================
-- login_page_visit_stats v3: trả thêm số trình duyệt ghé /login nhưng đã đăng nhập (bị loại khỏi
-- "Vào trang chủ" từ 20261034) để dashboard hiện "Đã đăng nhập: N" và 73 = khách mới + đăng nhập.
-- Giữ today/week/all như cũ (khách mới); thêm today_members/week_members/all_members.
-- Cùng signature → CREATE OR REPLACE, khai lại search_path + guard + REVOKE/GRANT.
-- ==============================================================================================

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
        )
        SELECT jsonb_build_object(
            'today',         COUNT(DISTINCT visitor_id) FILTER (WHERE NOT is_member AND visit_day >= v_today),
            'week',          COUNT(DISTINCT visitor_id) FILTER (WHERE NOT is_member AND visit_day >= v_week),
            'all',           COUNT(DISTINCT visitor_id) FILTER (WHERE NOT is_member),
            'today_members', COUNT(DISTINCT visitor_id) FILTER (WHERE is_member AND visit_day >= v_today),
            'week_members',  COUNT(DISTINCT visitor_id) FILTER (WHERE is_member AND visit_day >= v_week),
            'all_members',   COUNT(DISTINCT visitor_id) FILTER (WHERE is_member)
        ) FROM v
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION login_page_visit_stats() TO authenticated;
