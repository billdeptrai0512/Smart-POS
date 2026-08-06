-- ============================================================
-- set_my_email — chủ tài khoản tự khai/sửa email của chính mình — 2026-08-02
--
-- Email là đường DUY NHẤT để đặt lại mật khẩu (Edge Function request-password-reset
-- đọc users.email). Tài khoản tạo trước 2026-08-02 đều có email = NULL → phải có
-- chỗ khai bổ sung, nếu không "Quên mật khẩu" vô dụng với họ.
--
-- Cùng khuôn với set_my_phone: SECURITY DEFINER, ownership guard nằm ngay trong
-- mệnh đề WHERE auth_id = auth.uid() (không đụng được row của người khác).
-- KHÔNG ràng buộc unique: 2 tài khoản dùng chung 1 email vẫn ổn vì reset tra theo
-- username, không tra theo email.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

CREATE OR REPLACE FUNCTION set_my_email(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Chưa đăng nhập' USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_email := lower(trim(p_email));
    IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'Email không hợp lệ';
    END IF;

    UPDATE users SET email = v_email WHERE auth_id = auth.uid();
    RETURN v_email;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_email(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_my_email(TEXT) TO authenticated;
