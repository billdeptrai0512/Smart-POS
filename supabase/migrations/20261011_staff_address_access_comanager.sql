-- Fix: owner/manager không bỏ được quyền xem chi nhánh của tài khoản quản lý ("Only staff branch access can be changed").
-- Prod đang chạy bản cũ (chỉ staff) của RPC; bản cho cả co-manager ở 20260629_staff_panel_management.sql chưa được apply.

BEGIN;

-- ---- RPC: manager bật/tắt 1 chi nhánh cho 1 nhân viên ----
CREATE OR REPLACE FUNCTION public.set_staff_address_access(
    p_user_id    UUID,
    p_address_id UUID,
    p_allowed    BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role           TEXT;
    v_target_manager UUID;
    v_auth_id        UUID;
    v_addr_manager   UUID;
    v_owner          UUID;
BEGIN
    SELECT role, manager_id, auth_id INTO v_role, v_target_manager, v_auth_id
    FROM users WHERE id = p_user_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'User % not found', p_user_id;
    END IF;

    SELECT manager_id INTO v_addr_manager FROM addresses WHERE id = p_address_id;
    IF v_addr_manager IS NULL THEN
        RAISE EXCEPTION 'Address % not found', p_address_id;
    END IF;

    -- Ownership guard. Skip when auth.uid() IS NULL (service_role / migrations bypass).
    IF auth.uid() IS NOT NULL THEN
        v_owner := public.auth_owner_id(auth.uid());
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can set branch access' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_target_manager IS DISTINCT FROM v_owner THEN
            RAISE EXCEPTION 'User % is not on your team', p_user_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_addr_manager IS DISTINCT FROM v_owner THEN
            RAISE EXCEPTION 'Address % is not yours', p_address_id USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Giới hạn được nhân viên VÀ co-manager. Owner (manager_id NULL) đã bị chặn
    -- bởi ownership guard ở trên (manager_id phải = v_owner). Không đụng admin.
    IF v_role NOT IN ('staff', 'manager') THEN
        RAISE EXCEPTION 'Cannot change branch access for a % user', v_role USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_allowed THEN
        DELETE FROM user_address_revoked WHERE user_id = p_user_id AND address_id = p_address_id;
        IF v_auth_id IS NOT NULL THEN
            INSERT INTO user_address_access (auth_id, address_id)
            VALUES (v_auth_id, p_address_id)
            ON CONFLICT DO NOTHING;
        END IF;
    ELSE
        INSERT INTO user_address_revoked (user_id, address_id)
        VALUES (p_user_id, p_address_id)
        ON CONFLICT DO NOTHING;
        IF v_auth_id IS NOT NULL THEN
            DELETE FROM user_address_access WHERE auth_id = v_auth_id AND address_id = p_address_id;
        END IF;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_staff_address_access(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_staff_address_access(UUID, UUID, BOOLEAN) TO authenticated;

COMMIT;
