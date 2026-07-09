-- ============================================================
-- Nút "Xoá dữ liệu bán hàng" (Admin) trên thẻ địa chỉ: hard-delete
-- toàn bộ dữ liệu giao dịch của 1 địa chỉ, giữ nguyên config
-- (menu/recipes/ingredients/subscription). Dùng cho case setup ban
-- đầu user test lung tung làm sai báo cáo các ngày sau.
--
-- Xoá: orders (cascade order_items), expenses (cascade
-- expense_payments), shift_closings, fixed_costs.
-- KHÔNG đụng: products, recipes, ingredient_costs, product_extras,
-- expense_categories, addresses, user_address_access,
-- address_subscriptions/payment_intents/trial_grants.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_wipe_address_sales_data(p_address_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_orders   INT;
    v_expenses INT;
    v_closings INT;
    v_fixed    INT;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xoá dữ liệu bán hàng'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_address_id IS NULL THEN
        RAISE EXCEPTION 'Cần address_id';
    END IF;

    DELETE FROM orders WHERE address_id = p_address_id;
    GET DIAGNOSTICS v_orders = ROW_COUNT;

    DELETE FROM expenses WHERE address_id = p_address_id;
    GET DIAGNOSTICS v_expenses = ROW_COUNT;

    DELETE FROM shift_closings WHERE address_id = p_address_id;
    GET DIAGNOSTICS v_closings = ROW_COUNT;

    DELETE FROM fixed_costs WHERE address_id = p_address_id;
    GET DIAGNOSTICS v_fixed = ROW_COUNT;

    RETURN jsonb_build_object(
        'orders', v_orders,
        'expenses', v_expenses,
        'shift_closings', v_closings,
        'fixed_costs', v_fixed
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_wipe_address_sales_data(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_wipe_address_sales_data(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_wipe_address_sales_data(UUID) TO authenticated;
