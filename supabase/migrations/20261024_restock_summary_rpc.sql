-- ==============================================================================================
-- get_restock_summary — gom nhập kho / rút ra quầy theo (nguyên liệu, địa chỉ) NGAY TRONG DB.
--
-- Trang "Tổng hợp nhập kho" trước đây kéo về client toàn bộ expenses + inventory_report của mọi phiếu chốt ca trong kỳ rồi
-- cộng ở JS → chọn khoảng ngày dài (cả năm) thì nặng. RPC này trả đúng 1 dòng / (nguyên liệu, địa chỉ).
--
-- Quy tắc giống hệt aggregateRestockSummary ở client (src/services/restockSummaryService.ts):
--   nhập  = expenses.is_refill, bỏ metadata.cancelled / metadata.adjustment; qty = metadata.qty, spent = amount,
--           owing = max(0, amount − Σ expense_payments).
--   rút   = Σ inventory_report[].restock của shift_closings (>0), tính theo created_at của phiếu chốt ca.
--
-- Hàm mới → SET search_path = public, ownership guard (admin OR manager_id = auth_owner_id OR user_address_access;
-- skip khi auth.uid() IS NULL), REVOKE PUBLIC/anon + GRANT authenticated.
-- Client tự rơi về cách cộng ở JS nếu migration chưa apply (lỗi hàm không tồn tại) → apply trước hay sau deploy đều không vỡ.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_restock_summary(
    p_address_ids UUID[],
    p_from        TIMESTAMPTZ,
    p_to          TIMESTAMPTZ
)
RETURNS TABLE (
    ingredient    TEXT,
    address_id    UUID,
    qty           NUMERIC,
    spent         NUMERIC,
    owing         NUMERIC,
    withdrawn_qty NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Ownership guard: MỌI địa chỉ truyền vào đều phải thuộc quyền người gọi. Skip khi service_role/migration.
    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(p_address_ids) AS a(id)
        WHERE NOT EXISTS (
            SELECT 1 FROM addresses ad
            WHERE ad.id = a.id
              AND (
                  public.is_admin_auth(auth.uid())
                  OR ad.manager_id = public.auth_owner_id(auth.uid())
                  OR ad.id IN (SELECT uaa.address_id FROM user_address_access uaa WHERE uaa.auth_id = auth.uid())
              )
        )
    ) THEN
        RAISE EXCEPTION 'Permission denied for addresses' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH imp AS (
        SELECT e.metadata->>'ingredient' AS ing,
               e.address_id AS addr,
               SUM(CASE WHEN jsonb_typeof(e.metadata->'qty') = 'number' THEN (e.metadata->>'qty')::numeric ELSE 0 END) AS q,
               SUM(COALESCE(e.amount, 0)) AS s,
               SUM(GREATEST(0, COALESCE(e.amount, 0)
                   - COALESCE((SELECT SUM(p.amount) FROM expense_payments p WHERE p.expense_id = e.id), 0))) AS o
        FROM expenses e
        WHERE e.address_id = ANY(p_address_ids)
          AND e.is_refill
          AND e.created_at >= p_from AND e.created_at <= p_to
          AND e.metadata->>'ingredient' IS NOT NULL
          AND NOT COALESCE((e.metadata->>'cancelled')::BOOLEAN, false)
          AND NOT COALESCE((e.metadata->>'adjustment')::BOOLEAN, false)
        GROUP BY 1, 2
    ),
    wd AS (
        SELECT item->>'ingredient' AS ing,
               c.address_id AS addr,
               SUM((item->>'restock')::numeric) AS w
        FROM shift_closings c
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.inventory_report) = 'array' THEN c.inventory_report ELSE '[]'::jsonb END
        ) AS item
        WHERE c.address_id = ANY(p_address_ids)
          AND c.created_at >= p_from AND c.created_at <= p_to
          AND item->>'ingredient' IS NOT NULL
          AND jsonb_typeof(item->'restock') = 'number'
          AND (item->>'restock')::numeric > 0
        GROUP BY 1, 2
    )
    SELECT COALESCE(i.ing, w.ing)::TEXT,
           COALESCE(i.addr, w.addr)::UUID,
           COALESCE(i.q, 0)::NUMERIC,
           COALESCE(i.s, 0)::NUMERIC,
           COALESCE(i.o, 0)::NUMERIC,
           COALESCE(w.w, 0)::NUMERIC
    FROM imp i
    FULL OUTER JOIN wd w ON w.ing = i.ing AND w.addr = i.addr;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_restock_summary(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_restock_summary(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMIT;
