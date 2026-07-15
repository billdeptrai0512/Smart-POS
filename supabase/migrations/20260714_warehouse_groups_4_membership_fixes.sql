-- ==============================================================================================
-- Kho tổng dùng chung nhiều địa chỉ — Phase 4: vá 2 bug phát hiện sau khi test tay trên prod
-- (3 migration warehouse_groups_1/2/3 đã apply trước đó — file này CHỈ sửa thân hàm, chữ ký
-- không đổi nên không cần REVOKE/GRANT).
--
-- BUG 1 — sync_group_unit_cost dùng INSERT...ON CONFLICT DO UPDATE → nếu 1 nguyên liệu chưa
-- tồn tại ở 1 địa chỉ thành viên, fan-out tự tạo "dòng ma" với unit mặc định 'đv' (sai đơn vị,
-- thiếu category/pack). FIX: đổi UPDATE-only, khớp đúng hành vi UPDATE gốc trước khi có nhóm —
-- nguyên liệu chưa có ở thành viên nào thì không tự sinh, giữ nguyên quy trình "thêm nguyên liệu
-- mới" hiện có (per-address, không đổi).
--
-- BUG 2 — set_address_warehouse_group / delete_warehouse_group chỉ tính lại giá vốn cho CHÍNH
-- địa chỉ đang thao tác, bỏ sót các thành viên CÒN LẠI khi 1 địa chỉ rời/đổi nhóm hoặc khi xoá
-- cả nhóm → giá vốn của họ giữ số cũ (tính cả phần mua hàng của địa chỉ đã rời) cho tới lần
-- Nhập kho/Hủy/Sửa kế tiếp mới tự sửa. Không đối xứng với lúc JOIN (đã tính lại ngay). FIX: tính
-- lại giá vốn cho cả nhóm cũ (rời/đổi) hoặc từng cựu thành viên (xoá nhóm) ngay tại thời điểm đó.
-- ==============================================================================================

BEGIN;

-- ── Fix 1: sync_group_unit_cost — UPDATE-only, không tự tạo dòng ingredient_costs mới ─────────
CREATE OR REPLACE FUNCTION public.sync_group_unit_cost(p_address_id UUID, p_ingredient TEXT, p_unit_cost NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE ingredient_costs
    SET unit_cost = p_unit_cost
    WHERE ingredient = p_ingredient
      AND address_id = ANY(public.get_warehouse_group_address_ids(p_address_id));
END;
$$;

-- ── Fix 2a: set_address_warehouse_group — tính lại giá vốn cho NHÓM CŨ khi rời/đổi nhóm ────────
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
    END IF;

    SELECT warehouse_group_id INTO v_old_group_id FROM addresses WHERE id = p_address_id;
    UPDATE addresses SET warehouse_group_id = p_group_id WHERE id = p_address_id;

    -- Đồng bộ giá vốn cho nhóm MỚI (gồm cả địa chỉ vừa join, nếu có).
    FOR v_ingredient IN
        SELECT DISTINCT ingredient FROM ingredient_costs
        WHERE address_id = ANY(public.get_warehouse_group_address_ids(p_address_id))
    LOOP
        PERFORM public.recompute_group_unit_cost(p_address_id, v_ingredient);
    END LOOP;

    -- FIX: đồng bộ lại giá vốn cho các thành viên CÒN LẠI của nhóm CŨ (nếu vừa rời/đổi sang nhóm
    -- khác) — trước fix này họ bị bỏ sót, giữ giá vốn tính cả phần mua hàng của địa chỉ đã rời.
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

-- ── Fix 2b: delete_warehouse_group — tính lại giá vốn cho TỪNG cựu thành viên (nay solo) ───────
CREATE OR REPLACE FUNCTION public.delete_warehouse_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_ids UUID[];
    v_member_id  UUID;
    v_ingredient TEXT;
BEGIN
    IF p_group_id IS NULL THEN
        RAISE EXCEPTION 'p_group_id is required';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM warehouse_groups
        WHERE id = p_group_id
          AND (public.is_admin_auth(auth.uid()) OR manager_id = public.auth_owner_id(auth.uid()))
    ) THEN
        RAISE EXCEPTION 'Group % is not yours', p_group_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT array_agg(id) INTO v_member_ids FROM addresses WHERE warehouse_group_id = p_group_id;

    DELETE FROM warehouse_groups WHERE id = p_group_id; -- ON DELETE SET NULL gỡ nhóm khỏi mọi thành viên

    -- FIX: mỗi cựu thành viên giờ solo — tính lại giá vốn riêng, tránh giữ giá vốn "chung" cũ
    -- tính cả phần mua hàng của các thành viên khác không còn liên quan.
    IF v_member_ids IS NOT NULL THEN
        FOREACH v_member_id IN ARRAY v_member_ids LOOP
            FOR v_ingredient IN SELECT DISTINCT ingredient FROM ingredient_costs WHERE address_id = v_member_id LOOP
                PERFORM public.recompute_group_unit_cost(v_member_id, v_ingredient);
            END LOOP;
        END LOOP;
    END IF;
END;
$$;

COMMIT;
