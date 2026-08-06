-- ==============================================================================================
-- get_ingredient_stocks_v2 — counter_stock fallback về `opening` khi NVL chưa từng có `remaining`.
--
-- Bối cảnh: onboarding địa chỉ mới cho nhập "Tồn quầy" ở /ingredients TRƯỚC lần chốt ca đầu
-- tiên (saveCounter ở IngredientDetailPage giờ ghi vào `opening` (khoá) của phiếu hôm nay qua
-- merge_shift_closing_inventory thay vì báo lỗi "chưa có phiếu chốt ca"). Nếu counter_stock chỉ
-- đọc `remaining` như cũ, số vừa nhập sẽ không hiện ra ở /ingredients cho tới khi chốt ca đầu
-- tiên xong — gây cảm giác "nhập mà không thấy gì".
--
-- Đổi DUY NHẤT: counter_stock = remaining khác-null gần nhất (như cũ); NVL nào CHƯA từng có
-- remaining (chưa qua lần chốt ca nào) → fallback opening khác-null gần nhất. remaining luôn
-- thắng khi cả hai cùng tồn tại (đúng ngữ nghĩa "lần đếm cuối thực sự"). Mọi phần khác giữ
-- nguyên 100% so với 20260714_warehouse_groups_3_inventory_rpcs.sql.
--
-- Chữ ký không đổi → không cần REVOKE/GRANT lại theo CLAUDE.md, nhưng vẫn khai lại
-- SET search_path=public (bắt buộc) và giữ GRANT theo đúng convention các migration trước.
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
    v_group_ids     UUID[];
BEGIN
    v_group_ids := public.get_warehouse_group_address_ids(p_address_id);

    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL — QUẦY, không pool, chỉ p_address_id.
    counter_remaining_cte AS (
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
    -- Fallback khi NVL CHƯA từng có remaining (chưa qua lần chốt ca nào) — opening khác-null
    -- gần nhất. Cho phép "Tồn quầy" nhập lúc setup ban đầu hiện ra ngay, trước chốt ca đầu tiên.
    counter_opening_cte AS (
        SELECT DISTINCT ON (elem->>'ingredient')
            (elem->>'ingredient')::TEXT AS ing,
            (elem->>'opening')::NUMERIC AS counter
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND elem->>'ingredient' IS NOT NULL
          AND elem->>'opening' IS NOT NULL
        ORDER BY elem->>'ingredient', sc.created_at DESC
    ),
    counter_cte AS (
        SELECT
            COALESCE(r.ing, o.ing) AS ing,
            COALESCE(r.counter, o.counter) AS counter
        FROM counter_remaining_cte r
        FULL OUTER JOIN counter_opening_cte o ON o.ing = r.ing
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
    -- Rút ra quầy ở BẤT KỲ địa chỉ nào trong nhóm đều trừ vào cùng pool.
    closings_flat AS (
        SELECT
            sc.created_at,
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = ANY(v_group_ids)
          AND sc.inventory_report IS NOT NULL
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
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock
    FROM all_keys k
    LEFT JOIN warehouse_cte w ON w.ing = k.ing
    LEFT JOIN counter_cte   c ON c.ing = k.ing
    LEFT JOIN today_cte     t ON t.ing = k.ing;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ingredient_stocks_v2(UUID) TO authenticated;
