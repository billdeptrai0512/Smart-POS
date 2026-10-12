-- ==============================================================================================
-- Kho tổng chung: nhóm do ADMIN tạo phải thuộc về CHỦ CỦA ĐỊA CHỈ; tạo+gộp atomic; hub tự gỡ khi rời nhóm.
--
-- Lỗi gốc: upsert_warehouse_group gắn manager_id = auth_owner_id(người gọi). Admin tạo nhóm cho địa chỉ của chủ khác →
-- nhóm mang id admin, chủ thật không đọc được (RLS/fetch theo manager_id) → modal "Kho tổng chung" trống dù địa chỉ vẫn
-- nằm trong nhóm (đã gặp: 103 Hoàng Sa, 12/10/2026). set_address_warehouse_group lại cho admin gắn địa chỉ của chủ A
-- vào nhóm của chủ B mà không báo lỗi. Client gọi "tạo" rồi "gộp" thành 2 request → hỏng giữa chừng để lại nhóm rỗng.
--
-- Fix: (1) create_warehouse_group_and_join (MỚI): tạo nhóm + gộp địa chỉ trong 1 transaction, chủ nhóm = chủ ĐỊA CHỈ.
--      (2) set_address_warehouse_group: từ chối khi chủ nhóm ≠ chủ địa chỉ (chỉ chặn lần gắn MỚI — dữ liệu cũ lệch
--          chủ không bị đụng); tự gỡ hub_address_id của nhóm cũ khi địa chỉ hub rời nhóm.
--      (3) upsert_warehouse_group về lại 2 tham số (chỉ còn dùng để đổi tên). File này idempotent: chạy lại an toàn
--          dù bản trước của nó (có p_owner_id) đã apply.
-- Hàm mới → REVOKE PUBLIC/anon + GRANT authenticated. Apply TRƯỚC khi deploy client.
-- ==============================================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.upsert_warehouse_group(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.upsert_warehouse_group(p_group_id UUID DEFAULT NULL, p_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'p_name is required';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_manager_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Only managers can manage warehouse groups' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_group_id IS NULL THEN
        INSERT INTO warehouse_groups (manager_id, name)
        VALUES (public.auth_owner_id(auth.uid()), btrim(p_name))
        RETURNING id INTO v_id;
    ELSE
        IF auth.uid() IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM warehouse_groups
            WHERE id = p_group_id
              AND (public.is_admin_auth(auth.uid()) OR manager_id = public.auth_owner_id(auth.uid()))
        ) THEN
            RAISE EXCEPTION 'Group % is not yours', p_group_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        UPDATE warehouse_groups SET name = btrim(p_name) WHERE id = p_group_id;
        v_id := p_group_id;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_warehouse_group(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_warehouse_group(UUID, TEXT) TO authenticated;

-- Cùng signature với bản 20260714_4 → grant giữ nguyên. Thêm 1 guard: chủ nhóm phải trùng chủ địa chỉ.
CREATE OR REPLACE FUNCTION public.set_address_warehouse_group(p_address_id UUID, p_group_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner        UUID;
    v_old_group_id UUID;
    v_anchor_id    UUID;
    v_ingredient   TEXT;
BEGIN
    IF p_address_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id is required';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        v_owner := public.auth_owner_id(auth.uid());
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can manage warehouse groups' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM addresses
            WHERE id = p_address_id AND (public.is_admin_auth(auth.uid()) OR manager_id = v_owner)
        ) THEN
            RAISE EXCEPTION 'Address % is not yours', p_address_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF p_group_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM warehouse_groups
            WHERE id = p_group_id AND (public.is_admin_auth(auth.uid()) OR manager_id = v_owner)
        ) THEN
            RAISE EXCEPTION 'Group % is not yours', p_group_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        -- Admin qua được 2 guard trên với mọi chủ → vẫn bắt nhóm và địa chỉ cùng chủ, kẻo chủ thật không đọc được nhóm.
        IF p_group_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM addresses a JOIN warehouse_groups g ON g.manager_id = a.manager_id
            WHERE a.id = p_address_id AND g.id = p_group_id
        ) THEN
            RAISE EXCEPTION 'Group % belongs to a different owner than address %', p_group_id, p_address_id USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    SELECT warehouse_group_id INTO v_old_group_id FROM addresses WHERE id = p_address_id;
    UPDATE addresses SET warehouse_group_id = p_group_id WHERE id = p_address_id;
    -- Hub rời nhóm (hoặc sang nhóm khác) → nhóm cũ không còn kho tổng; đừng để hub_address_id trỏ vào người ngoài nhóm.
    UPDATE warehouse_groups SET hub_address_id = NULL WHERE hub_address_id = p_address_id AND id IS DISTINCT FROM p_group_id;

    -- Đồng bộ giá vốn cho nhóm MỚI (gồm cả địa chỉ vừa join, nếu có).
    FOR v_ingredient IN
        SELECT DISTINCT ingredient FROM ingredient_costs
        WHERE address_id = ANY(public.get_warehouse_group_address_ids(p_address_id))
    LOOP
        PERFORM public.recompute_group_unit_cost(p_address_id, v_ingredient);
    END LOOP;

    -- Đồng bộ lại giá vốn cho các thành viên CÒN LẠI của nhóm CŨ (nếu vừa rời/đổi sang nhóm khác).
    IF v_old_group_id IS NOT NULL AND v_old_group_id IS DISTINCT FROM p_group_id THEN
        SELECT id INTO v_anchor_id FROM addresses WHERE warehouse_group_id = v_old_group_id LIMIT 1;
        IF v_anchor_id IS NOT NULL THEN
            FOR v_ingredient IN
                SELECT DISTINCT ingredient FROM ingredient_costs
                WHERE address_id = ANY(public.get_warehouse_group_address_ids(v_anchor_id))
            LOOP
                PERFORM public.recompute_group_unit_cost(v_anchor_id, v_ingredient);
            END LOOP;
        END IF;
    END IF;
END;
$$;

-- Tạo nhóm + gộp địa chỉ vào đó trong 1 transaction. Chủ nhóm = chủ của ĐỊA CHỈ (admin tạo cho chủ khác vẫn đúng chủ).
-- Guard quyền (manager-only, địa chỉ của mình / admin) nằm sẵn trong set_address_warehouse_group được gọi bên dưới;
-- ở đây chỉ cần đủ để biết chủ địa chỉ. Hỏng bất kỳ bước nào → rollback, không để lại nhóm rỗng.
CREATE OR REPLACE FUNCTION public.create_warehouse_group_and_join(p_address_id UUID, p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
DECLARE
    v_owner UUID;
    v_id    UUID;
BEGIN
    IF p_address_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id is required';
    END IF;
    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'p_name is required';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.is_manager_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Only managers can manage warehouse groups' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT manager_id INTO v_owner FROM addresses WHERE id = p_address_id;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Address % not found', p_address_id;
    END IF;
    IF auth.uid() IS NOT NULL AND NOT (public.is_admin_auth(auth.uid()) OR v_owner = public.auth_owner_id(auth.uid())) THEN
        RAISE EXCEPTION 'Address % is not yours', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO warehouse_groups (manager_id, name) VALUES (v_owner, btrim(p_name)) RETURNING id INTO v_id;
    PERFORM public.set_address_warehouse_group(p_address_id, v_id);
    RETURN v_id;
END;
$;

REVOKE EXECUTE ON FUNCTION public.create_warehouse_group_and_join(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_warehouse_group_and_join(UUID, TEXT) TO authenticated;

COMMIT;
