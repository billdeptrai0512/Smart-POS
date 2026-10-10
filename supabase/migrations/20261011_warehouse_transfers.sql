-- ==============================================================================================
-- Phiếu soạn/xuất kho nội bộ cho nhóm kho chung (warehouse groups) — bước 2: quản lý nhập số soạn cho từng
-- chi nhánh (toàn quyền, không phụ thuộc dự báo) rồi lưu nháp / chốt.
--
-- 1 phiếu = (nhóm, ngày dùng). Dòng phiếu = (chi nhánh, nguyên liệu, số lượng). Chốt phiếu CHƯA trừ kho tổng —
-- kho chỉ trừ khi chi nhánh ghi "Nhập thêm" (restock) lúc chốt ca, như hiện nay. Bước 3 (giao/nhận) sẽ thêm cột
-- trạng thái nhận trên dòng phiếu và nối với restock.
--
-- Ghi CHỈ qua RPC save_warehouse_transfer (atomic, có guard). Bảng không có policy ghi → client không INSERT/UPDATE
-- trực tiếp được. Hàm mới (signature mới) → REVOKE PUBLIC/anon + GRANT authenticated; khai SET search_path = public.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_transfers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   UUID NOT NULL REFERENCES warehouse_groups(id) ON DELETE CASCADE,
    for_date   DATE NOT NULL,
    status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (group_id, for_date)
);

CREATE TABLE IF NOT EXISTS warehouse_transfer_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
    address_id  UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    ingredient  TEXT NOT NULL,
    unit        TEXT,
    qty         NUMERIC NOT NULL CHECK (qty > 0),
    UNIQUE (transfer_id, address_id, ingredient)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_address ON warehouse_transfer_items(address_id);

ALTER TABLE warehouse_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfer_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON warehouse_transfers, warehouse_transfer_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON warehouse_transfers, warehouse_transfer_items FROM authenticated;

DROP POLICY IF EXISTS "warehouse_transfers_select" ON warehouse_transfers;
DROP POLICY IF EXISTS "warehouse_transfer_items_select" ON warehouse_transfer_items;

-- Cùng quy tắc nhìn thấy nhóm như warehouse_groups_select.
CREATE POLICY "warehouse_transfers_select" ON warehouse_transfers
    FOR SELECT USING (
        public.is_admin_auth(auth.uid())
        OR group_id IN (SELECT g.id FROM warehouse_groups g WHERE g.manager_id = public.auth_owner_id(auth.uid()))
        OR group_id IN (
            SELECT a.warehouse_group_id FROM addresses a
            WHERE a.warehouse_group_id IS NOT NULL
              AND a.id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
        )
    );

-- Nhân viên chỉ thấy dòng của địa chỉ mình được vào; quản lý thấy cả phiếu.
CREATE POLICY "warehouse_transfer_items_select" ON warehouse_transfer_items
    FOR SELECT USING (
        public.is_admin_auth(auth.uid())
        OR transfer_id IN (
            SELECT t.id FROM warehouse_transfers t
            JOIN warehouse_groups g ON g.id = t.group_id
            WHERE g.manager_id = public.auth_owner_id(auth.uid())
        )
        OR address_id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
    );

-- Lưu phiếu của (nhóm, ngày): tạo hoặc ghi đè toàn bộ dòng. p_items = [{address_id, ingredient, unit, qty}], dòng qty = 0 bị bỏ.
-- ponytail: ghi đè = xoá + chèn lại; bước 3 (có trạng thái nhận trên dòng) phải đổi sang upsert theo khoá + chặn sửa dòng đã nhận.
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

    DELETE FROM warehouse_transfer_items WHERE transfer_id = v_id;

    INSERT INTO warehouse_transfer_items (transfer_id, address_id, ingredient, unit, qty)
    SELECT v_id, (e->>'address_id')::UUID, e->>'ingredient', e->>'unit', (e->>'qty')::NUMERIC
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e
    WHERE (e->>'qty')::NUMERIC > 0;

    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_warehouse_transfer(UUID, DATE, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_warehouse_transfer(UUID, DATE, JSONB, TEXT) TO authenticated;

COMMIT;
