-- ==============================================================================================
-- "Soạn cho ngày mai" của từng địa chỉ trong nhóm kho chung — dấu XÁC NHẬN từng dòng (địa chỉ, nguyên liệu, ngày).
--
-- Số lượng cần soạn tính ở client từ dự báo bán (như "Soạn cho hôm nay"); DB chỉ nhớ "đã soạn" để các máy thấy chung.
-- CHỈ LÀ BẰNG CHỨNG: không nhập thêm, không xuất kho, không đụng tồn (kho chỉ trừ khi chi nhánh ghi "Nhập thêm").
--
-- Dùng lại warehouse_transfers / warehouse_transfer_items (migration 20261011/13): 1 dòng = (nhóm, ngày, địa chỉ, nguyên liệu)
-- với qty = số đã xác nhận và packed_at = mốc xác nhận. Khác set_warehouse_transfer_packed (chỉ UPDATE dòng có sẵn), RPC này
-- UPSERT đúng 1 dòng nên không đụng dòng của địa chỉ khác; bỏ xác nhận thì xoá dòng. Phiếu tạo ở trạng thái 'draft'; ngày hôm sau
-- fetchTransferToAddress trả dòng đã xác nhận (packed_at) cho "Chuẩn bị hôm nay" ở POS ("Kho tổng chia: X ✓ đã soạn bởi <tên>").
--
-- Hàm mới → SET search_path = public, REVOKE PUBLIC/anon + GRANT authenticated, ownership guard như save_warehouse_transfer.
-- ==============================================================================================

BEGIN;

-- Ai đã xác nhận (tên lúc xác nhận) — hiện ở modal "Soạn cho ngày mai" và "Chuẩn bị hôm nay" để quản lý/nhân viên đối chiếu.
ALTER TABLE warehouse_transfer_items ADD COLUMN IF NOT EXISTS packed_by_name TEXT;

CREATE OR REPLACE FUNCTION public.set_tomorrow_prep_confirmed(
    p_group_id   UUID,
    p_for_date   DATE,
    p_address_id UUID,
    p_ingredient TEXT,
    p_unit       TEXT,
    p_qty        NUMERIC,
    p_confirmed  BOOLEAN
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id   UUID;
    v_at   TIMESTAMPTZ;
    v_name TEXT;
BEGIN
    IF p_group_id IS NULL OR p_for_date IS NULL OR p_address_id IS NULL OR p_ingredient IS NULL THEN
        RAISE EXCEPTION 'p_group_id, p_for_date, p_address_id and p_ingredient are required';
    END IF;

    -- Ownership guard: quản lý của nhóm, HOẶC nhân viên được vào địa chỉ đó (nhân viên cũng xác nhận được, có ghi tên).
    -- Skip khi service_role/migration (auth.uid() IS NULL).
    IF auth.uid() IS NOT NULL THEN
        IF NOT (
            (public.is_manager_auth(auth.uid()) AND EXISTS (
                SELECT 1 FROM warehouse_groups g
                WHERE g.id = p_group_id
                  AND (public.is_admin_auth(auth.uid()) OR g.manager_id = public.auth_owner_id(auth.uid()))
            ))
            OR EXISTS (SELECT 1 FROM user_address_access WHERE auth_id = auth.uid() AND address_id = p_address_id)
        ) THEN
            RAISE EXCEPTION 'Not allowed to confirm prep for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        SELECT name INTO v_name FROM users WHERE auth_id = auth.uid();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM addresses WHERE id = p_address_id AND warehouse_group_id = p_group_id) THEN
        RAISE EXCEPTION 'Address % is not in group %', p_address_id, p_group_id;
    END IF;

    IF NOT p_confirmed THEN
        DELETE FROM warehouse_transfer_items i
        USING warehouse_transfers t
        WHERE t.id = i.transfer_id AND t.group_id = p_group_id AND t.for_date = p_for_date
          AND i.address_id = p_address_id AND i.ingredient = p_ingredient;
        RETURN NULL;
    END IF;

    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'invalid qty for %', p_ingredient;
    END IF;

    INSERT INTO warehouse_transfers (group_id, for_date, status)
    VALUES (p_group_id, p_for_date, 'draft')
    ON CONFLICT (group_id, for_date) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_id;

    v_at := now();
    INSERT INTO warehouse_transfer_items (transfer_id, address_id, ingredient, unit, qty, packed_at, packed_by_name)
    VALUES (v_id, p_address_id, p_ingredient, p_unit, p_qty, v_at, v_name)
    ON CONFLICT (transfer_id, address_id, ingredient) DO UPDATE
        SET unit = EXCLUDED.unit, qty = EXCLUDED.qty, packed_at = EXCLUDED.packed_at, packed_by_name = EXCLUDED.packed_by_name;

    RETURN v_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_tomorrow_prep_confirmed(UUID, DATE, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_tomorrow_prep_confirmed(UUID, DATE, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated;

COMMIT;
