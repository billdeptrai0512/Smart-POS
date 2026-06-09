-- ==============================================================================================
-- get_ingredient_stocks_v2 — sửa counter_stock thành CARRY-FORWARD remaining khác-null.
--
-- Bug trước đây:
--   counter_stock chỉ đọc remaining của MỘT phiếu chốt mới nhất, null → 0.
--   ⇒ Ca nào nhân viên KHÔNG đếm một NVL (remaining null) thì tồn quầy của NVL đó bị
--     kéo về 0 oan, dù ca trước vừa đếm còn 39. Tồn kho /ingredients tụt sai.
--   Đường JS fallback (ingredientService.js) đã carry-forward đúng, nên 2 đường ra số
--     khác nhau (RPC = đường chạy thật ở production). Migration này cho RPC khớp JS.
--
-- Đổi DUY NHẤT cách lấy counter:
--   counter_stock = remaining KHÁC-NULL gần nhất (theo created_at DESC) của từng NVL,
--                   quét mọi phiếu chốt — "lần cuối thực sự đếm được".
--   restocked_qty = restock của phiếu chốt MỚI NHẤT (giữ nguyên: số "nhập thêm hôm nay").
--   warehouse_stock / current_stock: công thức không đổi.
--
-- Output shape giữ nguyên 100% — drop-in, không cần đổi client.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION get_ingredient_stocks_v2(p_address_id UUID)
RETURNS TABLE (
    ingredient TEXT,
    current_stock NUMERIC,
    restocked_qty NUMERIC,
    warehouse_stock NUMERIC,
    counter_stock NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_latest_report JSONB;
BEGIN
    -- Phiếu chốt mới nhất — chỉ để lấy "restock hôm nay" (restocked_qty).
    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL (quét mọi phiếu).
    -- null = "ca đó không đếm NVL này" → giữ lần đếm thật gần nhất, không zero.
    counter_cte AS (
        SELECT DISTINCT ON (elem->>'ingredient')
            (elem->>'ingredient')::TEXT AS ing,
            (elem->>'remaining')::NUMERIC AS counter
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND elem->>'ingredient' IS NOT NULL
          AND elem->>'remaining' IS NOT NULL
        ORDER BY elem->>'ingredient', sc.created_at DESC
    ),
    -- "Nhập thêm hôm nay" — restock của riêng phiếu chốt mới nhất.
    today_cte AS (
        SELECT
            (elem->>'ingredient')::TEXT AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS today_restock
        FROM jsonb_array_elements(COALESCE(v_latest_report, '[]'::JSONB)) AS elem
        WHERE elem->>'ingredient' IS NOT NULL
    ),
    refill_cte AS (
        SELECT
            (e.metadata->>'ingredient')::TEXT AS ing,
            SUM(COALESCE((e.metadata->>'qty')::NUMERIC, 0)) AS total_refill,
            MIN(e.created_at) AS first_refill_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
        GROUP BY (e.metadata->>'ingredient')::TEXT
    ),
    closings_flat AS (
        SELECT
            sc.created_at,
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
    ),
    restock_cte AS (
        SELECT
            c.ing,
            SUM(c.restock) AS total_restock
        FROM closings_flat c
        JOIN refill_cte r ON r.ing = c.ing
        WHERE c.created_at >= r.first_refill_at
          AND c.ing IS NOT NULL
        GROUP BY c.ing
    ),
    all_keys AS (
        SELECT ing FROM counter_cte
        UNION SELECT ing FROM today_cte
        UNION SELECT ing FROM refill_cte
        UNION SELECT ing FROM restock_cte
    )
    SELECT
        k.ing AS ingredient,
        (GREATEST(0, COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0)) + COALESCE(c.counter, 0))::NUMERIC AS current_stock,
        COALESCE(t.today_restock, 0)::NUMERIC AS restocked_qty,
        GREATEST(0, COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0))::NUMERIC AS warehouse_stock,
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock
    FROM all_keys k
    LEFT JOIN counter_cte c ON c.ing = k.ing
    LEFT JOIN today_cte   t ON t.ing = k.ing
    LEFT JOIN refill_cte  r ON r.ing = k.ing
    LEFT JOIN restock_cte rs ON rs.ing = k.ing;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ingredient_stocks_v2(UUID) TO authenticated;
