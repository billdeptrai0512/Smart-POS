-- ==============================================================================================
-- Kho tổng dùng chung nhiều địa chỉ — Phase 2: helper functions + RPC quản lý nhóm.
--
-- get_warehouse_group_address_ids / sync_group_unit_cost / recompute_group_unit_cost là hàm nội
-- bộ (KHÔNG grant cho authenticated) — chỉ được gọi từ bên trong các RPC SECURITY DEFINER khác
-- (chạy dưới quyền owner của hàm nên không cần EXECUTE grant cho role gọi gốc).
-- ==============================================================================================

BEGIN;

-- Trả toàn bộ address_id cùng nhóm với p_address_id, hoặc ARRAY[p_address_id] nếu không thuộc
-- nhóm nào — nhờ vậy mọi call site dùng `= ANY(...)` tự động tương đương hành vi cũ khi ungrouped.
CREATE OR REPLACE FUNCTION public.get_warehouse_group_address_ids(p_address_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT array_agg(a2.id)
         FROM addresses a1
         JOIN addresses a2 ON a2.warehouse_group_id = a1.warehouse_group_id
         WHERE a1.id = p_address_id AND a1.warehouse_group_id IS NOT NULL),
        ARRAY[p_address_id]
    );
$$;

-- Ghi CÙNG 1 unit_cost vào dòng ingredient_costs của MỌI thành viên trong nhóm (hoặc chỉ chính
-- p_address_id nếu không thuộc nhóm nào). Chỉ set unit_cost — KHÔNG đụng category/pack_size/
-- pack_unit/min_stock/tare_weight/unit riêng của từng địa chỉ (các field đó không hợp nhất).
CREATE OR REPLACE FUNCTION public.sync_group_unit_cost(p_address_id UUID, p_ingredient TEXT, p_unit_cost NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_member_id UUID;
BEGIN
    FOREACH v_member_id IN ARRAY public.get_warehouse_group_address_ids(p_address_id)
    LOOP
        INSERT INTO ingredient_costs (ingredient, unit_cost, address_id)
        VALUES (p_ingredient, p_unit_cost, v_member_id)
        ON CONFLICT (ingredient, address_id) DO UPDATE SET unit_cost = EXCLUDED.unit_cost;
    END LOOP;
END;
$$;

-- Full re-average (kiểu cancel_restock) trên TOÀN NHÓM của p_address_id, rồi fan-out kết quả.
-- Dùng chung cho cancel_restock / edit_ingredient_restock / set_address_warehouse_group để không
-- lặp lại cùng 1 khối SQL 3 lần.
CREATE OR REPLACE FUNCTION public.recompute_group_unit_cost(p_address_id UUID, p_ingredient TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_qty  NUMERIC;
    v_total_cost NUMERIC;
    v_new_cost   NUMERIC;
BEGIN
    SELECT COALESCE(SUM(COALESCE((metadata->>'qty')::NUMERIC, 0)), 0),
           COALESCE(SUM(amount), 0)
    INTO v_total_qty, v_total_cost
    FROM expenses
    WHERE address_id = ANY(public.get_warehouse_group_address_ids(p_address_id))
      AND is_refill = true
      AND metadata->>'ingredient' = p_ingredient
      AND COALESCE((metadata->>'adjustment')::BOOLEAN, false) = false
      AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
      AND amount > 0;

    IF v_total_qty > 0 THEN
        v_new_cost := ROUND(v_total_cost / v_total_qty);
        PERFORM public.sync_group_unit_cost(p_address_id, p_ingredient, v_new_cost);
    END IF;

    RETURN v_new_cost; -- NULL nếu không còn phiếu mua thật nào — giữ nguyên unit_cost hiện tại
END;
$$;

-- RPC public: sửa giá vốn thủ công (thay client upsert trực tiếp, để đi qua fan-out khi có nhóm).
CREATE OR REPLACE FUNCTION public.set_ingredient_unit_cost(p_address_id UUID, p_ingredient TEXT, p_unit_cost NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_address_id IS NULL OR p_ingredient IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_ingredient are required';
    END IF;
    IF p_unit_cost IS NULL OR p_unit_cost < 0 THEN
        RAISE EXCEPTION 'p_unit_cost must be >= 0';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    PERFORM public.sync_group_unit_cost(p_address_id, p_ingredient, p_unit_cost);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_ingredient_unit_cost(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_ingredient_unit_cost(UUID, TEXT, NUMERIC) TO authenticated;

-- Tạo (p_group_id NULL) hoặc đổi tên (p_group_id có giá trị) 1 warehouse group. Manager-only.
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

-- Xoá 1 nhóm. ON DELETE SET NULL tự gỡ nhóm khỏi các địa chỉ thành viên. Manager-only.
CREATE OR REPLACE FUNCTION public.delete_warehouse_group(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    DELETE FROM warehouse_groups WHERE id = p_group_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_warehouse_group(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_warehouse_group(UUID) TO authenticated;

-- Cho 1 địa chỉ vào nhóm (p_group_id có giá trị) hoặc rời nhóm (p_group_id NULL). Manager-only,
-- validate cả address lẫn group thuộc cùng 1 manager. Sau khi đổi, tính lại giá vốn hợp nhất
-- (full re-average) cho mọi nguyên liệu của tập address_id MỚI, để nhóm nhất quán ngay lúc join
-- thay vì đợi lần Nhập kho kế tiếp.
CREATE OR REPLACE FUNCTION public.set_address_warehouse_group(p_address_id UUID, p_group_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner      UUID;
    v_ingredient TEXT;
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

    UPDATE addresses SET warehouse_group_id = p_group_id WHERE id = p_address_id;

    FOR v_ingredient IN
        SELECT DISTINCT ingredient FROM ingredient_costs
        WHERE address_id = ANY(public.get_warehouse_group_address_ids(p_address_id))
    LOOP
        PERFORM public.recompute_group_unit_cost(p_address_id, v_ingredient);
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_address_warehouse_group(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_address_warehouse_group(UUID, UUID) TO authenticated;

COMMIT;
