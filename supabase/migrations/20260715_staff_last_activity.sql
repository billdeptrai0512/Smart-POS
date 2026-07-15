-- ==============================================================================================
-- 20260715_staff_last_activity.sql
-- Nhân sự tab: "Truy cập lần cuối" đang đọc auth.users.last_sign_in_at, nhưng session Supabase
-- tự refresh token vô thời hạn (persistSession/autoRefreshToken mặc định) và app chỉ signOut()
-- khi bấm "ĐĂNG XUẤT" thủ công — nên last_sign_in_at đứng yên ở ngày đăng nhập ĐẦU TIÊN trên
-- thiết bị dù nhân viên vẫn bán hàng mỗi ngày bằng phiên cũ. Hiển thị sai mức độ hoạt động thật.
--
-- Fix: lấy thêm active_sessions.last_seen — heartbeat có sẵn (POSContext, mỗi 5 phút khi đang
-- mở 1 địa chỉ để bán hàng, xem authService.js upsertSession) — và ưu tiên giá trị mới nhất giữa
-- 2 nguồn. GREATEST() của Postgres tự bỏ qua NULL (chưa từng có active_sessions, hoặc chưa từng
-- đăng nhập) nên không cần COALESCE riêng.
--
-- Giữ nguyên signature/tên hàm (get_staff_last_logins, cùng RETURNS TABLE) để không phải đổi gì
-- ở client — chỉ đổi nguồn dữ liệu bên trong.
--
-- Tuân thủ CLAUDE.md: SET search_path, ownership guard giữ nguyên như 20260710, REVOKE/GRANT lặp
-- lại cho chắc dù signature không đổi.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_staff_last_logins(p_user_ids UUID[])
RETURNS TABLE (user_id UUID, last_sign_in_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, GREATEST(au.last_sign_in_at, s.last_seen)
    FROM users u
    JOIN auth.users au ON au.id = u.auth_id
    LEFT JOIN active_sessions s ON s.user_id = u.id
    WHERE u.id = ANY(p_user_ids)
      AND (
          auth.uid() IS NULL -- service_role / migrations bypass
          OR u.manager_id = (SELECT id FROM users WHERE auth_id = auth.uid())
      );
$$;

REVOKE EXECUTE ON FUNCTION public.get_staff_last_logins(UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_staff_last_logins(UUID[]) TO authenticated;

COMMIT;
