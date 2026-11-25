-- ============================================================
-- set_my_name — chủ tài khoản tự đặt/sửa tên hiển thị của mình
--
-- Đăng ký không còn hỏi "Họ và Tên" (users.name tạm = tên đăng nhập) → đổi ở dialog Tài khoản.
-- set_team_member_name không dùng được cho chủ quán (manager_id NULL, không thuộc team của chính mình).
-- Cùng khuôn set_my_email: ownership guard nằm trong WHERE auth_id = auth.uid().
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

CREATE OR REPLACE FUNCTION set_my_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := trim(p_name);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Chưa đăng nhập' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_name IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Tên không được để trống' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE users SET name = v_name WHERE auth_id = auth.uid();
    RETURN v_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_name(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_my_name(TEXT) TO authenticated;
