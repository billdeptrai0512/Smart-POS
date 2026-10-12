-- ==============================================================================================
-- Phiếu chia hàng — dấu tick "đã soạn" của kho tổng, theo từng dòng (chi nhánh, nguyên liệu).
--
-- CHỈ LÀ BẰNG CHỨNG: tick không nhập thêm, không xuất kho, không đụng tồn. Kho tổng chỉ trừ khi chi nhánh
-- ghi "Nhập thêm" (restock) — nguồn sự thật duy nhất của việc trừ kho.
--
-- 1) save_warehouse_transfer: từ "xoá hết + chèn lại" sang upsert theo khoá, để lưu nháp/sửa phiếu không làm mất tick.
--    Dòng đổi số lượng thì tick bị bỏ (bằng chứng của số cũ không còn đúng). Dòng bị gỡ khỏi phiếu thì xoá.
-- 2) set_warehouse_transfer_packed: bật/tắt tick 1 dòng — RPC riêng, vì bảng không có policy ghi.
--
-- Hàm cũ giữ nguyên signature + guard, khai lại SET search_path = public. Hàm mới: REVOKE PUBLIC/anon + GRANT authenticated.
-- ==============================================================================================

BEGIN;

ALTER TABLE warehouse_transfer_items ADD COLUMN IF NOT EXISTS packed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.save_warehouse_transfer(
    p_group_id UUID,
    p_for_date DATE,
    p_items    JSONB,
    p_status   TEXT DEFAULT 'draft'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id   UUID;
    v_item JSONB;
    v_qty  NUMERIC;
BEGIN
    IF p_group_id IS NULL OR p_for_date IS NULL THEN
        RAISE EXCEPTION 'p_group_id and p_for_date are required';
    END IF;
    IF p_status NOT IN ('draft', 'issued') THEN
        RAISE EXCEPTION 'invalid status %', p_status;
    END IF;

    -- Ownership guard: manager-only, nhóm phải thuộc manager. Skip khi service_role/migration (auth.uid() IS NULL).
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can edit warehouse transfers' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM warehouse_groups g
            WHERE g.id = p_group_id
              AND (public.is_admin_auth(auth.uid()) OR g.manager_id = public.auth_owner_id(auth.uid()))
        ) THEN
            RAISE EXCEPTION 'Group % is not yours', p_group_id USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
        v_qty := (v_item->>'qty')::NUMERIC;
        IF v_qty IS NULL OR v_qty < 0 THEN
            RAISE EXCEPTION 'invalid qty for %', v_item->>'ingredient';
        END IF;
        IF v_qty > 0 AND NOT EXISTS (
            SELECT 1 FROM addresses
            WHERE id = (v_item->>'address_id')::UUID AND warehouse_group_id = p_group_id
        ) THEN
            RAISE EXCEPTION 'Address % is not in group %', v_item->>'address_id', p_group_id;
        END IF;
    END LOOP;

    INSERT INTO warehouse_transfers (group_id, for_date, status)
    VALUES (p_group_id, p_for_date, p_status)
    ON CONFLICT (group_id, for_date) DO UPDATE SET status = EXCLUDED.status, updated_at = now()
    RETURNING id INTO v_id;

    DELETE FROM warehouse_transfer_items i
    WHERE i.transfer_id = v_id
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e
          WHERE (e->>'qty')::NUMERIC > 0
            AND (e->>'address_id')::UUID = i.address_id
            AND e->>'ingredient' = i.ingredient
      );

    INSERT INTO warehouse_transfer_items AS i (transfer_id, address_id, ingredient, unit, qty)
    SELECT v_id, (e->>'address_id')::UUID, e->>'ingredient', e->>'unit', (e->>'qty')::NUMERIC
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e
    WHERE (e->>'qty')::NUMERIC > 0
    ON CONFLICT (transfer_id, address_id, ingredient) DO UPDATE
        SET unit      = EXCLUDED.unit,
            qty       = EXCLUDED.qty,
            packed_at = CASE WHEN i.qty = EXCLUDED.qty THEN i.packed_at END;

    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_warehouse_transfer(UUID, DATE, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_warehouse_transfer(UUID, DATE, JSONB, TEXT) TO authenticated;

-- Bật/tắt tick "đã soạn" 1 dòng của phiếu (nhóm, ngày). Trả mốc tick (NULL = đã bỏ tick).
CREATE OR REPLACE FUNCTION public.set_warehouse_transfer_packed(
    p_group_id   UUID,
    p_for_date   DATE,
    p_address_id UUID,
    p_ingredient TEXT,
    p_packed     BOOLEAN
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_at TIMESTAMPTZ := CASE WHEN p_packed THEN now() END;
BEGIN
    -- Ownership guard: như save_warehouse_transfer. Skip khi service_role/migration (auth.uid() IS NULL).
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can edit warehouse transfers' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM warehouse_groups g
            WHERE g.id = p_group_id
              AND (public.is_admin_auth(auth.uid()) OR g.manager_id = public.auth_owner_id(auth.uid()))
        ) THEN
            RAISE EXCEPTION 'Group % is not yours', p_group_id USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    UPDATE warehouse_transfer_items i
    SET packed_at = v_at
    FROM warehouse_transfers t
    WHERE t.id = i.transfer_id AND t.group_id = p_group_id AND t.for_date = p_for_date
      AND i.address_id = p_address_id AND i.ingredient = p_ingredient;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transfer line not found';
    END IF;

    RETURN v_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_warehouse_transfer_packed(UUID, DATE, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_warehouse_transfer_packed(UUID, DATE, UUID, TEXT, BOOLEAN) TO authenticated;

COMMIT;
