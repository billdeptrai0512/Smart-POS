-- ==============================================================================================
-- get_report_by_date — bỏ 3 mảng client KHÔNG đọc: yesterday_orders (kèm cả order_items của
-- ngày hôm trước), yesterday_expenses, yesterday_payments. useDailyReportData ở nhánh "1 ngày
-- quá khứ" chỉ lấy shift_closing / yesterday_closing / target_orders / target_expenses /
-- target_payments; grep cả src/ không chỗ nào đọc 3 key kia.
--
-- Cùng lý do và cùng đợt với 20260912_daily_report_context_trim.sql (hàm "Hôm nay").
--
-- Theo CLAUDE.md: CREATE OR REPLACE làm rơi `SET search_path` đã vá bằng ALTER trước đó nên
-- phải khai lại trong body. Hàm SECURITY INVOKER (dựa RLS của caller) → không có ownership
-- guard trong body cần giữ. Signature không đổi → quyền EXECUTE(authenticated) giữ nguyên,
-- không cần REVOKE/GRANT lại. Phần còn lại copy nguyên văn từ 20260818_report_rpc_cash_closed_at.sql.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_report_by_date(p_address_id UUID, p_date DATE)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_target_start TIMESTAMPTZ;
  v_target_end   TIMESTAMPTZ;
  v_prev_start   TIMESTAMPTZ;
  v_prev_end     TIMESTAMPTZ;
BEGIN
  v_target_start := (p_date::TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_target_end   := v_target_start + interval '1 day';
  v_prev_start   := v_target_start - interval '1 day';
  v_prev_end     := v_target_start;

  RETURN json_build_object(
    'shift_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_target_start AND closed_at < v_target_end
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_prev_start AND closed_at < v_prev_end
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'target_orders', (
      WITH target_orders AS (
        SELECT id, total, total_cost, discount_amount, payment_method, staff_name, created_at, deleted_at, deleted_by
        FROM orders
        WHERE address_id = p_address_id
          AND created_at >= v_target_start AND created_at < v_target_end
      ),
      target_items AS (
        SELECT oi.order_id, json_agg(json_build_object(
          'quantity',   oi.quantity,
          'product_id', oi.product_id,
          'unit_cost',  oi.unit_cost,
          'extra_ids',  oi.extra_ids,
          'options',    oi.options
        )) AS items
        FROM target_orders o
        JOIN order_items oi ON oi.order_id = o.id
        GROUP BY oi.order_id
      )
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',              o.id,
          'total',           o.total,
          'total_cost',      o.total_cost,
          'discount_amount', o.discount_amount,
          'payment_method',  o.payment_method,
          'staff_name',      o.staff_name,
          'created_at',      o.created_at,
          'deleted_at',      o.deleted_at,
          'deleted_by',      o.deleted_by,
          'order_items',     COALESCE(ti.items, '[]'::json)
        ) ORDER BY o.created_at DESC
      ), '[]'::json)
      FROM target_orders o
      LEFT JOIN target_items ti ON ti.order_id = o.id
    ),
    'target_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at,
               discount_amount, extra_cost
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_target_start AND created_at < v_target_end
      ) e
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
          AND pp.paid_at >= v_target_start AND pp.paid_at < v_target_end
      ) p
    )
  );
END;
$$;

COMMIT;
