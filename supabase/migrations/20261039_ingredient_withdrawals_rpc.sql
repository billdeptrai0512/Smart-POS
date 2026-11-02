-- Nhật ký NVL: tính "Tồn kho X → Y" của các lần rút ra quầy NGAY TRONG Postgres, thay cho việc client kéo
-- toàn bộ shift_closings (kèm inventory_report của MỌI nguyên liệu) của cả nhóm kho rồi replay bằng JS.
-- Logic = bản dịch nguyên văn của replay() trong fetchIngredientWithdrawals (ingredientStockService.ts):
--   • sự kiện = phiếu nhập (expenses is_refill, chưa hủy) + lần rút (inventory_report[].restock > 0), sắp theo
--     (created_at, refill trước withdrawal, id);
--   • phiếu nhập có after_stock VÀ địa chỉ không thuộc nhóm > 1 → đặt lại kho = after_stock (mốc neo); còn lại cộng dồn qty;
--   • lần rút trước phiếu nhập đầu tiên → before/after = NULL.
-- Hàm đọc, có ownership guard (copy từ get_ingredient_stocks_v2); client truyền 1 địa chỉ, nhóm kho tự suy ra.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_ingredient_withdrawals(
    p_address_id UUID,
    p_ingredient TEXT,
    p_from       TIMESTAMPTZ,
    p_to         TIMESTAMPTZ
)
RETURNS TABLE (
    id           TEXT,
    created_at   TIMESTAMPTZ,
    qty          NUMERIC,
    before_stock NUMERIC,
    after_stock  NUMERIC,
    staff_name   TEXT,
    address_id   UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_ids UUID[];
    v_see_all   BOOLEAN;
BEGIN
    -- Ownership guard — skip khi auth.uid() IS NULL (service_role/migration).
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE addresses.id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR addresses.id IN (SELECT user_address_access.address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_group_ids := public.get_warehouse_group_address_ids(p_address_id);
    -- Số tồn tính trên cả nhóm (như get_ingredient_stocks_v2) nhưng nhân viên chỉ thấy DÒNG RÚT của địa chỉ mình
    -- được cấp quyền — khớp RLS của đường JS cũ, không lộ người/số lượng của chi nhánh khác.
    v_see_all := auth.uid() IS NULL
        OR public.is_admin_auth(auth.uid())
        OR EXISTS (SELECT 1 FROM addresses WHERE addresses.id = p_address_id AND manager_id = public.auth_owner_id(auth.uid()));

    RETURN QUERY
    WITH
    events AS (
        SELECT e.created_at AS t, 0 AS kind_rank, e.id::TEXT AS eid,
               COALESCE((e.metadata->>'qty')::NUMERIC, 0) AS qty,
               CASE WHEN array_length(v_group_ids, 1) = 1 THEN (e.metadata->>'after_stock')::NUMERIC END AS anchor,
               NULL::TIMESTAMPTZ AS shown_at, NULL::TEXT AS staff, NULL::UUID AS addr
        FROM expenses e
        WHERE e.address_id = ANY(v_group_ids)
          AND e.is_refill = true
          AND e.metadata->>'ingredient' = p_ingredient
          AND COALESCE((e.metadata->>'cancelled')::BOOLEAN, false) = false
        UNION ALL
        SELECT sc.created_at, 1, sc.id::TEXT,
               (item->>'restock')::NUMERIC,
               NULL::NUMERIC,
               COALESCE((item->>'restock_at')::TIMESTAMPTZ, sc.created_at),
               COALESCE(item->>'restock_by_name', u.name),
               sc.address_id
        FROM shift_closings sc
        LEFT JOIN users u ON u.id = sc.closed_by
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(sc.inventory_report) = 'array' THEN sc.inventory_report ELSE '[]'::JSONB END) AS item
        WHERE sc.address_id = ANY(v_group_ids)
          AND sc.inventory_report @> jsonb_build_array(jsonb_build_object('ingredient', p_ingredient))
          AND item->>'ingredient' = p_ingredient
          AND COALESCE((item->>'restock')::NUMERIC, 0) > 0
    ),
    -- grp tăng ở mỗi mốc neo → trong 1 grp: kho = mốc neo đầu grp + Σ delta (refill thường +qty, rút −qty).
    ordered AS (
        SELECT ev.*,
               COUNT(ev.anchor) OVER w AS grp,
               COUNT(*) FILTER (WHERE ev.kind_rank = 0) OVER w AS refills_so_far
        FROM events ev
        WINDOW w AS (ORDER BY ev.t, ev.kind_rank, ev.eid ROWS UNBOUNDED PRECEDING)
    ),
    -- Lần rút TRƯỚC phiếu nhập đầu tiên không trừ kho (khớp "Σ restock sau lần refill đầu" của get_ingredient_stocks_v2).
    deltas AS (
        SELECT o.*,
               CASE WHEN o.kind_rank = 1 THEN CASE WHEN o.refills_so_far > 0 THEN -o.qty ELSE 0 END
                    WHEN o.anchor IS NULL THEN o.qty ELSE 0 END AS delta
        FROM ordered o
    ),
    replayed AS (
        SELECT o.*,
               COALESCE(MAX(o.anchor) OVER (PARTITION BY o.grp), 0)  -- đúng 1 mốc neo/grp (grp 0: không có → 0)
                   + SUM(o.delta) OVER (PARTITION BY o.grp ORDER BY o.t, o.kind_rank, o.eid ROWS UNBOUNDED PRECEDING) AS wh_after
        FROM deltas o
    )
    SELECT r.eid, r.shown_at, r.qty,
           CASE WHEN r.refills_so_far > 0 THEN ROUND(r.wh_after + r.qty, 1) END,
           CASE WHEN r.refills_so_far > 0 THEN ROUND(r.wh_after, 1) END,
           r.staff, r.addr
    FROM replayed r
    WHERE r.kind_rank = 1
      AND r.t BETWEEN p_from AND p_to
      AND (v_see_all OR r.addr IN (SELECT uaa.address_id FROM user_address_access uaa WHERE uaa.auth_id = auth.uid()))
    ORDER BY r.t DESC, r.eid DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ingredient_withdrawals(uuid, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_withdrawals(uuid, text, timestamptz, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ingredient_withdrawals(uuid, text, timestamptz, timestamptz) TO authenticated;

COMMIT;
