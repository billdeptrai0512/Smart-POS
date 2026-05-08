-- Server-side aggregation cho /ingredients tab "Nguyên liệu":
-- thay 3 query (latest closing + all closings + all refills) bằng 1 RPC pre-aggregated.
-- Output match shape của fetchIngredientStocks (JS) — drop-in replacement.
--
-- Logic giống JS hiện tại:
--   warehouse = max(0, Σ refill_qty − Σ restock_post_first_refill)
--   counter   = remaining từ shift_closing gần nhất
--   total     = warehouse + counter

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
    -- Latest shift_closing inventory_report (counter + today's restock)
    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    counter_cte AS (
        SELECT
            (elem->>'ingredient')::TEXT AS ing,
            COALESCE((elem->>'remaining')::NUMERIC, 0) AS counter,
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
        UNION
        SELECT ing FROM refill_cte
        UNION
        SELECT ing FROM restock_cte
    )
    SELECT
        k.ing AS ingredient,
        (GREATEST(0, COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0)) + COALESCE(c.counter, 0))::NUMERIC AS current_stock,
        COALESCE(c.today_restock, 0)::NUMERIC AS restocked_qty,
        GREATEST(0, COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0))::NUMERIC AS warehouse_stock,
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock
    FROM all_keys k
    LEFT JOIN counter_cte c ON c.ing = k.ing
    LEFT JOIN refill_cte r ON r.ing = k.ing
    LEFT JOIN restock_cte rs ON rs.ing = k.ing;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ingredient_stocks_v2(UUID) TO authenticated;
