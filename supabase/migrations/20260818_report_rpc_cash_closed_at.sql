-- ==============================================================================================
-- Loại 1 round-trip network thừa trên MỌI lần mở /daily-report (scope Hôm nay + Ngày quá khứ):
-- get_daily_report_context / get_report_by_date liệt kê cột shift_closing tường minh nhưng
-- THIẾU cash_closed_at (chỉ là bỏ sót cột, không phải chủ đích) — client phải bù bằng 1 PK
-- lookup riêng sau đó (attachCashClosedAt trong reportService.ts). Thêm thẳng cột vào 2 subquery
-- shift_closing/yesterday_closing của cả 2 hàm → client bớt hẳn round-trip đó (đã tự guard skip
-- nếu cột đã có sẵn trong response, xem attachCashClosedAt).
--
-- Body copy nguyên văn từ 20260612_invoice_payment_cash_phase.sql, chỉ thêm cột + search_path.
-- 2 hàm này SECURITY INVOKER (dựa RLS của caller, không bypass) nên không có ownership guard
-- nào trong body cần giữ nguyên — nhưng CLAUDE.md vẫn yêu cầu khai báo lại search_path vì
-- CREATE OR REPLACE làm rơi mọi ALTER FUNCTION SET search_path đã vá trước đó
-- (20260612_security_advisor_fixes.sql vá bằng ALTER, không nằm trong body CREATE gốc — không
-- khai báo lại ở đây thì regression y hệt 5 đợt trước, lần này với chính 2 hàm đó).
-- Signature không đổi → không cần REVOKE/GRANT lại (quyền EXECUTE(authenticated) đã cấp giữ nguyên).
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
    'target_orders', (
      SELECT COALESCE(json_agg(o_row), '[]'::json)
      FROM (
        SELECT json_build_object(
          'id',              o.id,
          'total',           o.total,
          'total_cost',      o.total_cost,
          'discount_amount', o.discount_amount,
          'payment_method',  o.payment_method,
          'staff_name',      o.staff_name,
          'created_at',      o.created_at,
          'deleted_at',      o.deleted_at,
          'deleted_by',      o.deleted_by,
          'order_items', COALESCE((
            SELECT json_agg(json_build_object(
              'quantity',   oi.quantity,
              'product_id', oi.product_id,
              'unit_cost',  oi.unit_cost,
              'extra_ids',  oi.extra_ids,
              'options',    oi.options
            ))
            FROM order_items oi WHERE oi.order_id = o.id
          ), '[]'::json)
        ) AS o_row
        FROM orders o
        WHERE o.address_id = p_address_id
          AND o.created_at >= v_today
        ORDER BY o.created_at DESC
      ) sub
    ),
    'target_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at,
               discount_amount, extra_cost
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_today
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
          AND pp.paid_at >= v_today
      ) p
    ),
    'yesterday_orders', (
      SELECT COALESCE(json_agg(o_row), '[]'::json)
      FROM (
        SELECT json_build_object(
          'total',      o.total,
          'total_cost', o.total_cost,
          'deleted_at', o.deleted_at
        ) AS o_row
        FROM orders o
        WHERE o.address_id = p_address_id
          AND o.created_at >= v_yesterday AND o.created_at < v_today
      ) sub
    ),
    'yesterday_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at,
               discount_amount, extra_cost
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_yesterday AND created_at < v_today
      ) e
    ),
    'yesterday_payments', (
      SELECT COALESCE(json_agg(p ORDER BY p.paid_at ASC), '[]'::json)
      FROM (
        SELECT pp.id, pp.expense_id, pp.amount, pp.payment_method, pp.staff_name, pp.paid_at,
               pp.cash_phase,
               ee.name AS invoice_name, ee.metadata AS invoice_metadata
        FROM expense_payments pp
        LEFT JOIN expenses ee ON ee.id = pp.expense_id
        WHERE pp.address_id = p_address_id
          AND pp.paid_at >= v_yesterday AND pp.paid_at < v_today
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
    ),
    'yesterday_orders', (
      WITH prev_orders AS (
        SELECT id, total, total_cost, staff_name, deleted_at
        FROM orders
        WHERE address_id = p_address_id
          AND created_at >= v_prev_start AND created_at < v_prev_end
      ),
      prev_items AS (
        SELECT oi.order_id, json_agg(json_build_object(
          'quantity',   oi.quantity,
          'product_id', oi.product_id,
          'unit_cost',  oi.unit_cost,
          'extra_ids',  oi.extra_ids
        )) AS items
        FROM prev_orders o
        JOIN order_items oi ON oi.order_id = o.id
        GROUP BY oi.order_id
      )
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',         o.id,
          'total',      o.total,
          'total_cost', o.total_cost,
          'staff_name', o.staff_name,
          'deleted_at', o.deleted_at,
          'order_items', COALESCE(pi.items, '[]'::json)
        ) ORDER BY o.id
      ), '[]'::json)
      FROM prev_orders o
      LEFT JOIN prev_items pi ON pi.order_id = o.id
    ),
    'yesterday_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at,
               discount_amount, extra_cost
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_prev_start AND created_at < v_prev_end
      ) e
    ),
    'yesterday_payments', (
      SELECT COALESCE(json_agg(p ORDER BY p.paid_at ASC), '[]'::json)
      FROM (
        SELECT pp.id, pp.expense_id, pp.amount, pp.payment_method, pp.staff_name, pp.paid_at,
               pp.cash_phase,
               ee.name AS invoice_name, ee.metadata AS invoice_metadata
        FROM expense_payments pp
        LEFT JOIN expenses ee ON ee.id = pp.expense_id
        WHERE pp.address_id = p_address_id
          AND pp.paid_at >= v_prev_start AND pp.paid_at < v_prev_end
      ) p
    )
  );
END;
$$;

COMMIT;
