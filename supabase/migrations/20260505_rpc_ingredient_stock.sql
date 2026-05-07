-- RPC tính tồn kho real-time
-- Logic: Tồn cuối ca TRƯỚC + Nhập thêm từ kho (ca HIỆN TẠI) + Mua hàng (expenses) - Đã bán (orders)
CREATE OR REPLACE FUNCTION get_ingredient_stocks(p_address_id UUID)
RETURNS TABLE (
    ingredient TEXT,
    opening_stock NUMERIC,
    restocked_qty NUMERIC,
    used_qty NUMERIC,
    current_stock NUMERIC
) 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_base_closing_time TIMESTAMP WITH TIME ZONE;
    v_base_inventory JSONB;
    v_current_inventory JSONB;
BEGIN
    -- Lấy 2 shift closings gần nhất
    -- Nếu có 2: base = ca trước (remaining = tồn đầu), current = ca hiện tại (restock = nhập từ kho)
    -- Nếu có 1: base = ca đó, không có daily transfer
    WITH recent_closings AS (
        SELECT created_at, inventory_report,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
        FROM shift_closings
        WHERE address_id = p_address_id
          AND inventory_report IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 2
    )
    SELECT 
        (SELECT inventory_report FROM recent_closings WHERE rn = 2),
        (SELECT created_at FROM recent_closings WHERE rn = 2),
        (SELECT inventory_report FROM recent_closings WHERE rn = 1)
    INTO v_base_inventory, v_base_closing_time, v_current_inventory;

    -- Nếu chỉ có 1 closing → dùng nó làm base, không có current
    IF v_base_closing_time IS NULL AND v_current_inventory IS NOT NULL THEN
        v_base_inventory := v_current_inventory;
        v_current_inventory := NULL;
        SELECT created_at INTO v_base_closing_time
        FROM shift_closings
        WHERE address_id = p_address_id AND inventory_report IS NOT NULL
        ORDER BY created_at DESC LIMIT 1;
    END IF;

    -- Nếu không có closing nào
    IF v_base_closing_time IS NULL THEN
        v_base_closing_time := '1970-01-01'::TIMESTAMP WITH TIME ZONE;
        v_base_inventory := '[]'::JSONB;
    END IF;

    RETURN QUERY
    WITH 
    -- Tồn đầu: remaining từ ca TRƯỚC
    opening_cte AS (
        SELECT 
            (elem->>'ingredient')::TEXT as ing,
            COALESCE((elem->>'remaining')::NUMERIC, 0) as opening
        FROM jsonb_array_elements(v_base_inventory) as elem
    ),
    -- Nhập từ kho: restock từ ca HIỆN TẠI (nếu có)
    transfer_cte AS (
        SELECT 
            (elem->>'ingredient')::TEXT as ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) as transferred
        FROM jsonb_array_elements(COALESCE(v_current_inventory, '[]'::JSONB)) as elem
        WHERE (elem->>'restock')::NUMERIC > 0
    ),
    -- Mua hàng: expenses (is_refill) sau ca trước
    purchase_cte AS (
        SELECT 
            (e.metadata->>'ingredient')::TEXT as ing,
            SUM(COALESCE((e.metadata->>'qty')::NUMERIC, 0)) as purchased
        FROM expenses e
        WHERE e.address_id = p_address_id 
          AND e.is_refill = true 
          AND e.created_at > v_base_closing_time
          AND e.metadata->>'ingredient' IS NOT NULL
        GROUP BY (e.metadata->>'ingredient')::TEXT
    ),
    -- Đã bán: từ orders + recipes
    used_main_cte AS (
        SELECT 
            r.ingredient as ing,
            SUM(r.amount * oi.quantity) as used_amount
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN recipes r ON r.product_id = oi.product_id
        WHERE o.address_id = p_address_id
          AND o.deleted_at IS NULL
          AND o.created_at > v_base_closing_time
        GROUP BY r.ingredient
    ),
    -- Đã bán: từ extras
    used_extra_cte AS (
        SELECT 
            ei.ingredient as ing,
            SUM(ei.amount * oi.quantity) as used_amount
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        CROSS JOIN LATERAL jsonb_array_elements_text(oi.extra_ids) as eid(extra_id)
        JOIN extra_ingredients ei ON ei.extra_id = eid.extra_id::UUID
        WHERE o.address_id = p_address_id
          AND o.deleted_at IS NULL
          AND o.created_at > v_base_closing_time
          AND oi.extra_ids IS NOT NULL
          AND jsonb_array_length(oi.extra_ids) > 0
        GROUP BY ei.ingredient
    ),
    used_total_cte AS (
        SELECT 
            COALESCE(m.ing, e.ing) as ing,
            COALESCE(m.used_amount, 0) + COALESCE(e.used_amount, 0) as total_used
        FROM used_main_cte m
        FULL OUTER JOIN used_extra_cte e ON m.ing = e.ing
    ),
    all_ingredients AS (
        SELECT ic.ingredient as ing 
        FROM ingredient_costs ic 
        WHERE ic.address_id = p_address_id
    )
    
    SELECT 
        a.ing,
        COALESCE(o.opening, 0)::NUMERIC,
        (COALESCE(t.transferred, 0) + COALESCE(p.purchased, 0))::NUMERIC,
        COALESCE(u.total_used, 0)::NUMERIC,
        (COALESCE(o.opening, 0) + COALESCE(t.transferred, 0) + COALESCE(p.purchased, 0) - COALESCE(u.total_used, 0))::NUMERIC
    FROM all_ingredients a
    LEFT JOIN opening_cte o ON a.ing = o.ing
    LEFT JOIN transfer_cte t ON a.ing = t.ing
    LEFT JOIN purchase_cte p ON a.ing = p.ing
    LEFT JOIN used_total_cte u ON a.ing = u.ing;
END;
$$ LANGUAGE plpgsql;
