-- ==============================================================================================
-- Quản lý/nhân viên bị thu hồi quyền xem chi nhánh (user_address_revoked) vẫn thấy chi nhánh đó ở /address:
-- addresses_select cho mọi địa chỉ có manager_id = auth_owner_id (cả team), mà RLS chỉ chặn menu/đơn qua
-- user_address_access. Mô hình hiện tại là REVOKE (mặc định thấy hết) — thêm điều kiện "không bị thu hồi" vào SELECT.
-- user_address_revoked chỉ quản lý của họ đọc được (RLS) nên policy không tự subquery được → hàm SECURITY DEFINER
-- chỉ trả lời cho CHÍNH người gọi (auth.uid()), không lộ dữ liệu người khác.
-- Admin và chủ (không có hàng revoked) không bị ảnh hưởng. Các policy insert/update/delete giữ nguyên.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.is_address_revoked_for_caller(p_address_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM user_address_revoked r
          JOIN users u ON u.id = r.user_id
         WHERE u.auth_id = auth.uid()
           AND r.address_id = p_address_id
    );
$$;

REVOKE EXECUTE ON FUNCTION public.is_address_revoked_for_caller(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_address_revoked_for_caller(uuid) TO authenticated;

DROP POLICY IF EXISTS "addresses_select" ON addresses;
CREATE POLICY "addresses_select" ON addresses
    FOR SELECT USING (
        public.is_admin_auth(auth.uid())
        OR (
            (
                manager_id = public.auth_owner_id(auth.uid())
                OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
            )
            AND NOT public.is_address_revoked_for_caller(id)
        )
    );
