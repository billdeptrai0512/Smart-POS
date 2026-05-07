-- Tạo function để xử lý Nghiệp vụ Nhập kho (Cập nhật giá vốn & Ghi nhận chi tiêu)
CREATE OR REPLACE FUNCTION process_ingredient_restock(
    p_address_id UUID,
    p_ingredient TEXT,
    p_qty NUMERIC,
    p_total_cost NUMERIC,
    p_staff_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_stock NUMERIC;
    v_old_unit_cost NUMERIC;
    v_new_unit_cost NUMERIC;
    v_expense_id UUID;
    v_display_name TEXT;
BEGIN
    -- 1. Tồn kho không còn dùng RPC tính real-time nữa, đọc trực tiếp từ shift_closings (tồn cuối ca trước)
    SELECT COALESCE(
        (SELECT (elem->>'remaining')::NUMERIC 
         FROM jsonb_array_elements(inventory_report) AS elem 
         WHERE (elem->>'ingredient')::TEXT = p_ingredient
         LIMIT 1), 
        0
    )
    INTO v_current_stock
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_current_stock IS NULL THEN v_current_stock := 0; END IF;
    IF v_current_stock < 0 THEN v_current_stock := 0; END IF;

    -- 2. Lấy Giá vốn hiện tại
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. Tính Giá vốn mới (Bình quân gia quyền)
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + p_total_cost) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    -- 4. Cập nhật Giá vốn mới
    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    -- 5. Tạo display name từ ingredient key (ca_phe -> Ca Phe)
    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

    -- 6. Tạo dòng tiền ra (Expense)
    INSERT INTO expenses (
        address_id,
        name,
        amount,
        is_fixed,
        is_refill,
        payment_method,
        staff_name,
        metadata
    ) VALUES (
        p_address_id,
        v_display_name,
        p_total_cost,
        false,
        true,
        'cash',
        p_staff_name,
        jsonb_build_object(
            'ingredient', p_ingredient,
            'qty', p_qty,
            'price', p_total_cost,
            'old_unit_cost', v_old_unit_cost,
            'new_unit_cost', v_new_unit_cost
        )
    ) RETURNING id INTO v_expense_id;

    -- 7. Trả về kết quả
    RETURN jsonb_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'old_unit_cost', v_old_unit_cost,
        'new_unit_cost', v_new_unit_cost,
        'added_qty', p_qty,
        'current_stock_before', v_current_stock
    );
END;
$$;
