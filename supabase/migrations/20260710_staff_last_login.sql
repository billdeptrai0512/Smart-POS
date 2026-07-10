-- ==============================================================================================
-- 20260710_staff_last_login.sql
-- Nhân sự tab: hiển thị "lần đăng nhập gần nhất" thay cho @username.
--
-- auth.users.last_sign_in_at đã có sẵn (Supabase Auth tự track), nhưng schema auth không
-- query được thẳng từ client (anon/authenticated không có quyền, và không nên cấp). Expose
-- qua 1 RPC SECURITY DEFINER, lọc đúng NHƯ fetchStaffByManager hiện tại: chỉ trả các user có
-- manager_id = chính caller (không phải auth_owner_id — co-manager tự invite thì manager_id
-- trỏ về co-manager đó, khớp hành vi client đang dùng).
--
-- Tuân thủ CLAUDE.md: SET search_path, ownership guard (skip khi auth.uid() IS NULL),
-- REVOKE FROM PUBLIC, anon + GRANT TO authenticated (signature mới).
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_staff_last_logins(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, last_sign_in_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, au.last_sign_in_at
    FROM users u
    JOIN auth.users au ON au.id = u.auth_id
    WHERE u.id = ANY(p_user_ids)
      AND (
          auth.uid() IS NULL -- service_role / migrations bypass
          OR u.manager_id = (SELECT id FROM users WHERE auth_id = auth.uid())
      );
$$;

REVOKE EXECUTE ON FUNCTION public.get_staff_last_logins(UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_staff_last_logins(UUID[]) TO authenticated;

COMMIT;
