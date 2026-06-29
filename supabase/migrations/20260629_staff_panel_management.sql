-- ==============================================================================================
-- 20260629_staff_panel_management.sql
-- Panel quản lý nhân sự (Nhân sự tab → từng thành viên):
--   1. Lưu `username` vào users để hiển thị (trước nay chỉ nằm trong auth.users email giả).
--   2. set_team_member_name — manager đổi họ tên thành viên.
--   3. Phân quyền chi nhánh theo MÔ HÌNH REVOKE (mặc định thấy tất cả, như cũ):
--        user_address_revoked ghi các (user, address) bị CẤM; trigger dựng lại
--        user_address_access loại trừ chúng. set_staff_address_access bật/tắt từng cái.
--
-- Tuân thủ CLAUDE.md (chống regression Security Advisor): mọi CREATE OR REPLACE FUNCTION
-- khai báo lại SET search_path, giữ ownership guard (skip khi auth.uid() IS NULL), và
-- signature mới kèm REVOKE FROM PUBLIC, anon + GRANT TO authenticated.
-- ==============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Cột username + backfill từ email đăng nhập (xxx@coffee.local → xxx)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE public.users u
SET username = split_part(a.email, '@', 1)
FROM auth.users a
WHERE u.auth_id = a.id
  AND (u.username IS NULL OR u.username = '');

-- ---------------------------------------------------------------------------
-- 2) set_team_member_name — manager đổi họ tên (cùng ownership guard với set_team_member_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_team_member_name(
    p_user_id UUID,
    p_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_role   TEXT;
    v_target_manager UUID;
    v_name           TEXT := trim(p_name);
BEGIN
    IF v_name IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Name cannot be empty' USING ERRCODE = 'check_violation';
    END IF;

    SELECT role, manager_id INTO v_current_role, v_target_manager
    FROM users WHERE id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'User % not found', p_user_id;
    END IF;

    -- Ownership guard. Skip when auth.uid() IS NULL (service_role / migrations bypass).
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can rename team members' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_target_manager IS DISTINCT FROM public.auth_owner_id(auth.uid()) THEN
            RAISE EXCEPTION 'User % is not on your team', p_user_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_current_role NOT IN ('staff', 'manager') THEN
            RAISE EXCEPTION 'Cannot rename a % user', v_current_role USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    UPDATE users SET name = v_name WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_team_member_name(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_team_member_name(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Phân quyền chi nhánh — bảng REVOKE (mặc định thấy tất cả)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_address_revoked (
    user_id    UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
    address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, address_id)
);

ALTER TABLE public.user_address_revoked ENABLE ROW LEVEL SECURITY;
REVOKE ALL    ON public.user_address_revoked FROM authenticated, anon;
GRANT  SELECT ON public.user_address_revoked TO authenticated;

-- Manager/admin đọc được danh sách cấm của nhân viên trong team (để render checkbox).
-- Ghi chỉ qua RPC SECURITY DEFINER bên dưới.
DROP POLICY IF EXISTS "uar_manager_read" ON public.user_address_revoked;
CREATE POLICY "uar_manager_read" ON public.user_address_revoked
    FOR SELECT USING (
        public.is_admin_auth(auth.uid())
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = user_address_revoked.user_id
              AND u.manager_id = public.auth_owner_id(auth.uid())
        )
    );

-- ---- Trigger dựng lại user_address_access, loại trừ các address bị revoke ----
-- CREATE OR REPLACE cùng signature: chỉ thêm điều kiện NOT EXISTS(revoked).
-- Re-khai báo SET search_path (PostgreSQL làm rơi khi replace).

CREATE OR REPLACE FUNCTION uaa_on_address_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;  -- ON DELETE CASCADE đã dọn
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id THEN
        RETURN NEW;  -- không đổi membership
    END IF;

    DELETE FROM user_address_access WHERE address_id = NEW.id;

    INSERT INTO user_address_access (auth_id, address_id)
    SELECT u.auth_id, NEW.id
    FROM users u
    WHERE u.auth_id IS NOT NULL
      AND u.role <> 'admin'
      AND COALESCE(u.manager_id, u.id) = NEW.manager_id
      -- Revoke áp cho mọi thành viên (nhân viên + co-manager). Owner (manager_id NULL)
      -- không bao giờ có revoked row → vẫn thấy tất cả.
      AND NOT EXISTS (
          SELECT 1 FROM user_address_revoked r
          WHERE r.user_id = u.id AND r.address_id = NEW.id
      )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION uaa_on_user_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    old_owner UUID;
    new_owner UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM user_address_access WHERE auth_id = OLD.auth_id;
        RETURN OLD;
    END IF;

    new_owner := COALESCE(NEW.manager_id, NEW.id);
    old_owner := CASE
        WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.manager_id, OLD.id)
        ELSE NULL
    END;

    IF TG_OP = 'UPDATE'
       AND NEW.auth_id IS NOT DISTINCT FROM OLD.auth_id
       AND NEW.role IS NOT DISTINCT FROM OLD.role
       AND new_owner IS NOT DISTINCT FROM old_owner THEN
        RETURN NEW;
    END IF;

    IF NEW.auth_id IS NOT NULL THEN
        DELETE FROM user_address_access WHERE auth_id = NEW.auth_id;

        IF NEW.role <> 'admin' THEN
            INSERT INTO user_address_access (auth_id, address_id)
            SELECT NEW.auth_id, a.id
            FROM addresses a
            WHERE a.manager_id = new_owner
              -- Revoke áp cho mọi thành viên (nhân viên + co-manager). Owner không có revoked row.
              AND NOT EXISTS (
                  SELECT 1 FROM user_address_revoked r
                  WHERE r.user_id = NEW.id AND r.address_id = a.id
              )
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.auth_id IS NOT NULL
       AND NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
        DELETE FROM user_address_access WHERE auth_id = OLD.auth_id;
    END IF;

    RETURN NEW;
END;
$$;

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
