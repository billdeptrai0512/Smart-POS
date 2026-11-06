-- ==============================================================================================
-- shift_closings.cash_saved_at — giờ LƯU CUỐI của Thực thu (tiền mặt / chuyển khoản).
--
-- cash_closed_at cố ý chỉ ghi lần lưu ĐẦU (mốc chia chi phí trước/sau chốt ca, không được dời)
-- nên pill giờ ở panel Thực thu không phản ánh lần sửa sau. Cột mới này được client đặt = now()
-- mỗi lần số tiền đổi; cash_closed_at giữ nguyên. Hàng cũ NULL → client rơi về cash_closed_at.
--
-- Hai RPC báo cáo trả thêm cash_saved_at. Theo CLAUDE.md: khai lại `SET search_path = public`;
-- SECURITY INVOKER (RLS của caller) nên không có ownership guard; signature không đổi → không
-- cần REVOKE/GRANT. Phần còn lại copy nguyên văn từ 20260912_*_trim.sql.
-- ==============================================================================================

BEGIN;

ALTER TABLE shift_closings ADD COLUMN IF NOT EXISTS cash_saved_at timestamptz;

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
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at, cash_saved_at
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_today
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at, cash_saved_at
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
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at, cash_saved_at
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_target_start AND closed_at < v_target_end
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue, cash_closed_at, cash_saved_at
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
