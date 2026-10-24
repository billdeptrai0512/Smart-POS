-- ==============================================================================================
-- "Vào trang chủ" (login_page_visits, 20261024) đang đếm cả nhân viên/quản lý ghé /login để đăng
-- nhập — họ đã có địa chỉ, không phải khách mới nên làm loãng phễu. Trình duyệt nào đăng nhập
-- thành công (AuthContext.signIn → mark_login_page_member) bị loại khỏi số "Vào trang chủ".
--
-- Bảng RIÊNG theo visitor_id (không đánh dấu từng dòng login_page_visits) để loại được CẢ các lượt
-- ghé trước lúc đăng nhập, và lượt ghé sau này của cùng trình duyệt (đăng xuất rồi vào lại).
--
-- Ngoại lệ: visitor đã từng bấm "Hướng dẫn sử dụng" (có dòng trong guest_onboarding_funnel) vẫn
-- giữ trong số ghé — khách dùng thử đã đăng ký rồi đăng nhập lại cũng là đăng nhập, nhưng họ là
-- người của phễu; loại họ khỏi đầu phễu sẽ làm các bước dưới đông hơn bước trên.
-- Chỉ tính từ lúc apply — lượt đăng nhập trước đó không truy lại được.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS login_page_members (
    visitor_id UUID PRIMARY KEY
);

ALTER TABLE login_page_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION mark_login_page_member(p_visitor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_visitor_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO login_page_members (visitor_id) VALUES (p_visitor_id) ON CONFLICT DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_login_page_member(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mark_login_page_member(UUID) TO anon, authenticated;

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

    RETURN (
        WITH v AS (
            SELECT visitor_id, visit_day
            FROM login_page_visits lv
            WHERE NOT EXISTS (SELECT 1 FROM login_page_members m WHERE m.visitor_id = lv.visitor_id)
               OR EXISTS (SELECT 1 FROM guest_onboarding_funnel g WHERE g.visitor_id = lv.visitor_id)
        )
        SELECT jsonb_build_object(
            'today', COUNT(DISTINCT visitor_id) FILTER (WHERE visit_day >= v_today),
            'week',  COUNT(DISTINCT visitor_id) FILTER (WHERE visit_day >= date_trunc('week', v_today)::date),
            'all',   COUNT(DISTINCT visitor_id)
        ) FROM v
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION login_page_visit_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION login_page_visit_stats() TO authenticated;

COMMIT;
