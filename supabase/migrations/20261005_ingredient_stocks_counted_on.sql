-- ==============================================================================================
-- get_ingredient_stocks_v2 — trả thêm MỐC ĐẾM CUỐI để client ước tính tồn quầy theo lý thuyết.
--
-- Tồn quầy (counter_stock) vẫn là remaining khác-null gần nhất như cũ — KHÔNG đổi. Quán nhiều NVL
-- không kiểm kê hằng ngày cần biết số đó ĐẾM TỪ NGÀY NÀO + đã nhập thêm bao nhiêu kể từ đó, để
-- client tính: ước tính = counter_stock + restock_since_count − Σ tiêu hao từ counter_counted_on.
-- (Tiêu hao = đơn × công thức, chỉ client có — DB không nhân bản logic đó.)
--
-- Hai cột MỚI (cuối bảng kết quả):
--   counter_counted_on   DATE    — ngày VN của phiếu chứa remaining mà counter_stock đang lấy.
--                                  NULL khi counter chỉ đến từ opening (nhập lúc setup) hoặc chưa có
--                                  số nào → client KHÔNG nối tiêu hao, hiển thị số thô như trước.
--   restock_since_count  NUMERIC — Σ restock của CHÍNH địa chỉ này ở các phiếu có ngày VN > ngày đếm
--                                  (restock cùng ngày đã nằm trong số đếm cuối ngày). 0 nếu không có.
--
-- Mọi công thức cũ (counter/today/refill/restock/anchor/warehouse/current_stock) giữ nguyên 100%.
-- RETURNS TABLE đổi → bắt buộc DROP + CREATE (cùng cách 20260720). Theo CLAUDE.md: khai lại
-- SET search_path = public, giữ nguyên ownership guard, REVOKE PUBLIC/anon + GRANT authenticated.
-- Client cũ (chưa biết 2 cột mới) bỏ qua cột thừa — apply migration TRƯỚC khi deploy client mới.
-- ==============================================================================================

BEGIN;

DROP FUNCTION IF EXISTS get_ingredient_stocks_v2(UUID);

CREATE FUNCTION get_ingredient_stocks_v2(p_address_id UUID)
RETURNS TABLE (
    ingredient TEXT,
    current_stock NUMERIC,
    restocked_qty NUMERIC,
    warehouse_stock NUMERIC,
    counter_stock NUMERIC,
    warehouse_stock_set BOOLEAN,
    counter_stock_set BOOLEAN,
    counter_counted_on DATE,
    restock_since_count NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_latest_report JSONB;
    v_group_ids     UUID[];
BEGIN
    -- Ownership guard — xem đầu file. Skip khi auth.uid() IS NULL (service_role/migration).
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

    v_group_ids := public.get_warehouse_group_address_ids(p_address_id);

    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- LƯỢT BUNG JSONB DUY NHẤT. Trải trên cả nhóm kho (rút ra quầy ở địa chỉ nào cũng trừ vào
    -- cùng pool); 2 CTE counter_* bên dưới lọc lại về riêng p_address_id.
    closings_flat AS (
        SELECT
            sc.address_id,
            sc.created_at,
            vn_business_date(COALESCE(sc.closed_at, sc.created_at)) AS vn_day,
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock,
            elem->>'remaining'  AS remaining_txt,
            elem->>'opening'    AS opening_txt
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = ANY(v_group_ids)
          AND sc.inventory_report IS NOT NULL
    ),
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL — QUẦY, không pool, chỉ p_address_id.
    counter_remaining_cte AS (
        SELECT DISTINCT ON (c.ing)
            c.ing,
            c.remaining_txt::NUMERIC AS counter,
            c.vn_day AS counted_on
        FROM closings_flat c
        WHERE c.address_id = p_address_id
          AND c.ing IS NOT NULL
          AND c.remaining_txt IS NOT NULL
        ORDER BY c.ing, c.created_at DESC
    ),
    -- Fallback khi NVL CHƯA từng có remaining (chưa qua lần chốt ca nào) — opening khác-null
    -- gần nhất. Cho phép "Tồn quầy" nhập lúc setup ban đầu hiện ra ngay, trước chốt ca đầu tiên.
    counter_opening_cte AS (
        SELECT DISTINCT ON (c.ing)
            c.ing,
            c.opening_txt::NUMERIC AS counter
        FROM closings_flat c
        WHERE c.address_id = p_address_id
          AND c.ing IS NOT NULL
          AND c.opening_txt IS NOT NULL
        ORDER BY c.ing, c.created_at DESC
    ),
    counter_cte AS (
        SELECT
            COALESCE(r.ing, o.ing) AS ing,
            COALESCE(r.counter, o.counter) AS counter,
            r.counted_on               -- NULL = counter chỉ từ opening (setup)
        FROM counter_remaining_cte r
        FULL OUTER JOIN counter_opening_cte o ON o.ing = r.ing
    ),
    -- Σ restock của địa chỉ này SAU ngày đếm cuối (ngày đếm đã gồm restock cùng ngày trong số cuối ngày).
    restock_after_count_cte AS (
        SELECT cc.ing, SUM(c.restock) AS total
        FROM counter_cte cc
        JOIN closings_flat c ON c.ing = cc.ing
        WHERE c.address_id = p_address_id
          AND cc.counted_on IS NOT NULL
          AND c.vn_day > cc.counted_on
        GROUP BY cc.ing
    ),
    -- "Nhập thêm hôm nay" — riêng của địa chỉ này, không pool.
    today_cte AS (
        SELECT
            (elem->>'ingredient')::TEXT AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS today_restock
        FROM jsonb_array_elements(COALESCE(v_latest_report, '[]'::JSONB)) AS elem
        WHERE elem->>'ingredient' IS NOT NULL
    ),
    -- KHO TỔNG: mua hàng ở BẤT KỲ địa chỉ nào trong nhóm đều cộng vào cùng pool.
    refill_cte AS (
        SELECT
            (e.metadata->>'ingredient')::TEXT AS ing,
            SUM(COALESCE((e.metadata->>'qty')::NUMERIC, 0)) AS total_refill,
            MIN(e.created_at) AS first_refill_at
        FROM expenses e
        WHERE e.address_id = ANY(v_group_ids)
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
        GROUP BY (e.metadata->>'ingredient')::TEXT
    ),
    -- Công thức CŨ (fallback): Σ restock sau lần refill đầu — nay tính trên cả nhóm.
    restock_cte AS (
        SELECT c.ing, SUM(c.restock) AS total_restock
        FROM closings_flat c
        JOIN refill_cte r ON r.ing = c.ing
        WHERE c.created_at >= r.first_refill_at
          AND c.ing IS NOT NULL
        GROUP BY c.ing
    ),
    -- MỐC NEO: chỉ áp dụng khi địa chỉ KHÔNG thuộc nhóm > 1 thành viên (anchor chỉ đúng trên
    -- timeline 1 địa chỉ — cộng dồn qua nhiều địa chỉ là vô nghĩa). Grouped → CTE rỗng → fallback.
    anchor_cte AS (
        SELECT DISTINCT ON (e.metadata->>'ingredient')
            (e.metadata->>'ingredient')::TEXT AS ing,
            (e.metadata->>'after_stock')::NUMERIC AS anchor_stock,
            e.created_at AS anchor_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND array_length(v_group_ids, 1) = 1
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
          AND e.metadata->>'after_stock' IS NOT NULL
          AND COALESCE((e.metadata->>'cancelled')::BOOLEAN, false) = false
        ORDER BY e.metadata->>'ingredient', e.created_at DESC
    ),
    -- Σ restock xảy ra SAU mốc neo (chỉ có ý nghĩa khi anchor_cte khác rỗng, tức ungrouped).
    restock_since_anchor AS (
        SELECT a.ing, SUM(c.restock) AS total
        FROM closings_flat c
        JOIN anchor_cte a ON a.ing = c.ing
        WHERE c.created_at > a.anchor_at
        GROUP BY a.ing
    ),
    all_keys AS (
        SELECT ing FROM counter_cte
        UNION SELECT ing FROM today_cte
        UNION SELECT ing FROM refill_cte
        UNION SELECT ing FROM restock_cte
    ),
    -- Có mốc neo (chỉ ungrouped) → kho = số neo − rút sau neo; còn lại → công thức cũ trên nhóm.
    warehouse_cte AS (
        SELECT
            k.ing,
            GREATEST(0, COALESCE(
                an.anchor_stock - COALESCE(rsa.total, 0),
                COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0)
            )) AS wh
        FROM all_keys k
        LEFT JOIN refill_cte           r   ON r.ing  = k.ing
        LEFT JOIN restock_cte          rs  ON rs.ing = k.ing
        LEFT JOIN anchor_cte           an  ON an.ing = k.ing
        LEFT JOIN restock_since_anchor rsa ON rsa.ing = k.ing
    )
    SELECT
        k.ing AS ingredient,
        (w.wh + COALESCE(c.counter, 0))::NUMERIC AS current_stock,
        COALESCE(t.today_restock, 0)::NUMERIC AS restocked_qty,
        w.wh::NUMERIC AS warehouse_stock,
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock,
        (rf.ing IS NOT NULL) AS warehouse_stock_set,
        (c.counter IS NOT NULL) AS counter_stock_set,
        c.counted_on AS counter_counted_on,
        COALESCE(ra.total, 0)::NUMERIC AS restock_since_count
    FROM all_keys k
    LEFT JOIN warehouse_cte w  ON w.ing  = k.ing
    LEFT JOIN counter_cte   c  ON c.ing  = k.ing
    LEFT JOIN today_cte     t  ON t.ing  = k.ing
    LEFT JOIN refill_cte    rf ON rf.ing = k.ing
    LEFT JOIN restock_after_count_cte ra ON ra.ing = k.ing;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) TO authenticated;

COMMIT;
