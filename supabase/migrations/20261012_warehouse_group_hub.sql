-- ==============================================================================================
-- Kho tổng của nhóm (hub): đánh dấu 1 địa chỉ trong nhóm kho chung là nơi giữ hàng thật (vd. Hoàng Sa).
-- Chỉ là nhãn để UI biết ai chia hàng / ai nhập kho — số tồn vẫn tính chung cho cả nhóm như cũ.
--
-- hub_address_id NULL = chưa đặt (hành vi cũ: mọi thành viên bình đẳng). ON DELETE SET NULL khi địa chỉ bị xoá.
-- Địa chỉ rời nhóm thì hub_address_id có thể trỏ vào địa chỉ không còn là thành viên — client coi như chưa đặt
-- (so warehouse_group_id) nên không cần sửa set_address_warehouse_group.
--
-- Hàm mới (signature mới) → REVOKE PUBLIC/anon + GRANT authenticated; khai SET search_path = public.
-- ==============================================================================================

BEGIN;

ALTER TABLE warehouse_groups
    ADD COLUMN IF NOT EXISTS hub_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL;

-- Đặt (p_address_id có giá trị) hoặc bỏ (NULL) kho tổng của nhóm. Manager-only; địa chỉ phải là thành viên nhóm.
CREATE OR REPLACE FUNCTION public.set_warehouse_group_hub(p_group_id UUID, p_address_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_group_id IS NULL THEN
        RAISE EXCEPTION 'p_group_id is required';
    END IF;

    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can manage warehouse groups' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM warehouse_groups
            WHERE id = p_group_id
              AND (public.is_admin_auth(auth.uid()) OR manager_id = public.auth_owner_id(auth.uid()))
        ) THEN
            RAISE EXCEPTION 'Group % is not yours', p_group_id USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF p_address_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses WHERE id = p_address_id AND warehouse_group_id = p_group_id
    ) THEN
        RAISE EXCEPTION 'Address % is not in group %', p_address_id, p_group_id;
    END IF;

    UPDATE warehouse_groups SET hub_address_id = p_address_id WHERE id = p_group_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_warehouse_group_hub(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_warehouse_group_hub(UUID, UUID) TO authenticated;

COMMIT;
