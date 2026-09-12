-- ==============================================================================================
-- get_daily_report_context — bỏ 5 mảng client KHÔNG đọc.
--
-- Hàm đang dựng và gửi về: target_orders (kèm TOÀN BỘ order_items của ngày), target_expenses,
-- yesterday_orders, yesterday_expenses, yesterday_payments. Nhưng useDailyReportData ở nhánh
-- "Hôm nay" chỉ lấy shift_closing / yesterday_closing / target_payments, và 3 mảng yesterday_*
-- thì không một chỗ nào trong src/ đọc tới. Đơn + chi phí của hôm nay lại được nạp riêng qua
-- fetchTodayOrders/fetchTodayExpenses (handleLoadHistory) — tức là server build JSON đơn cả
-- ngày hai lần, client vứt một bản.
--
-- Giữ lại target_payments: đó là driver của refill cashflow (theo paid_at), không có đường nạp
-- nào khác. LEFT JOIN expenses ở đó cũng giữ nguyên (invoice_name/invoice_metadata).
--
-- Theo CLAUDE.md: CREATE OR REPLACE làm rơi mọi ALTER FUNCTION SET search_path đã vá trước đó
-- nên phải khai lại `SET search_path = public` trong body. Hàm SECURITY INVOKER (dựa RLS của
-- caller) → không có ownership guard nào trong body cần giữ. Signature không đổi → quyền
-- EXECUTE(authenticated) đã cấp vẫn nguyên, không cần REVOKE/GRANT lại.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_daily_report_context(p_address_id UUID)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_today     TIMESTAMPTZ;
  v_yesterday TIMESTAMPTZ;
BEGIN
  v_today     := date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_yesterday := v_today - interval '1 day';

  RETURN json_build_object(
    'shift_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_today
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_yesterday AND closed_at < v_today
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'target_payments', (
      SELECT COALESCE(json_agg(p ORDER BY p.paid_at ASC), '[]'::json)
      FROM (
        SELECT pp.id, pp.expense_id, pp.amount, pp.payment_method, pp.staff_name, pp.paid_at,
               pp.cash_phase,
               ee.name AS invoice_name, ee.metadata AS invoice_metadata
        FROM expense_payments pp
        LEFT JOIN expenses ee ON ee.id = pp.expense_id
        WHERE pp.address_id = p_address_id
          AND pp.paid_at >= v_today
      ) p
    )
  );
END;
$$;

COMMIT;
