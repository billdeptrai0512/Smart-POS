-- =============================================
-- Fix timezone bug in get_daily_report_context
-- Previous migration (20260505) used CURRENT_DATE which returns server UTC date,
-- so between VN 00:00–07:00 (= UTC 17:00–23:59 prior day) the RPC's "today" was
-- still UTC yesterday → today's shift_closing/orders/expenses incorrectly mapped
-- to yesterday VN. Symptom: at 00:00 VN, "today's actual cash" shows yesterday's.
--
-- Use NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh' (wall-clock VN) → date_trunc('day')
-- → back to TIMESTAMPTZ. Identical to 20260504 (pre-regression).
-- =============================================

CREATE OR REPLACE FUNCTION get_daily_report_context(p_address_id UUID)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
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
               actual_cash, actual_transfer, system_total_revenue
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_today
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue
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
          'id',             o.id,
          'total',          o.total,
          'total_cost',     o.total_cost,
          'payment_method', o.payment_method,
          'staff_name',     o.staff_name,
          'created_at',     o.created_at,
          'deleted_at',     o.deleted_at,
          'deleted_by',     o.deleted_by,
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
        SELECT id, name, amount, staff_name, is_fixed, is_refill, payment_method, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_today
      ) e
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
        SELECT id, name, amount, staff_name, is_fixed, is_refill, payment_method, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_yesterday AND created_at < v_today
      ) e
    )
  );
END;
$$;
