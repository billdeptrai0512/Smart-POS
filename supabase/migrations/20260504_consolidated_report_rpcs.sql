-- =============================================
-- Consolidated RPCs for DailyReportPage
-- Reduces 4-6 separate API calls → 1 round trip
-- =============================================

-- ---------------------------------------------------------------------------
-- get_daily_report_context(p_address_id)
-- Replaces 4 parallel calls on today's view:
--   fetchTodayShiftClosing + fetchYesterdayShiftClosing
--   + fetchYesterdayOrders + fetchYesterdayExpenses
-- ---------------------------------------------------------------------------
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
    -- Today's latest shift closing
    'shift_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue
        FROM shift_closings
        WHERE address_id = p_address_id AND closed_at >= v_today
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    -- Yesterday's latest shift closing (for opening stock)
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_yesterday AND closed_at < v_today
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    -- Yesterday's orders with order_items (for profit comparison)
    'yesterday_orders', (
      SELECT COALESCE(json_agg(o_row), '[]'::json)
      FROM (
        SELECT json_build_object(
          'id',         o.id,
          'total',      o.total,
          'total_cost', o.total_cost,
          'staff_name', o.staff_name,
          'deleted_at', o.deleted_at,
          'order_items', COALESCE((
            SELECT json_agg(json_build_object(
              'quantity',   oi.quantity,
              'product_id', oi.product_id,
              'unit_cost',  oi.unit_cost,
              'extra_ids',  oi.extra_ids
            ))
            FROM order_items oi WHERE oi.order_id = o.id
          ), '[]'::json)
        ) AS o_row
        FROM orders o
        WHERE o.address_id = p_address_id
          AND o.created_at >= v_yesterday AND o.created_at < v_today
        ORDER BY o.created_at DESC
      ) sub
    ),
    -- Yesterday's expenses
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

-- ---------------------------------------------------------------------------
-- get_report_by_date(p_address_id, p_date)
-- Replaces 6 parallel calls on custom date view:
--   2x fetchShiftClosingsByRange + 2x fetchOrdersByRange + 2x fetchExpensesByRange
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_report_by_date(p_address_id UUID, p_date DATE)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  v_target_start TIMESTAMPTZ;
  v_target_end   TIMESTAMPTZ;
  v_prev_start   TIMESTAMPTZ;
  v_prev_end     TIMESTAMPTZ;
BEGIN
  -- Convert date to TIMESTAMPTZ range in VN timezone
  v_target_start := (p_date::TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_target_end   := v_target_start + interval '1 day';
  v_prev_start   := v_target_start - interval '1 day';
  v_prev_end     := v_target_start;

  RETURN json_build_object(
    -- Target date shift closing
    'shift_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_target_start AND closed_at < v_target_end
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    -- Previous day shift closing
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_prev_start AND closed_at < v_prev_end
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    -- Target date orders (full structure for HistoryView compatibility)
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
          AND o.created_at >= v_target_start AND o.created_at < v_target_end
        ORDER BY o.created_at DESC
      ) sub
    ),
    -- Target date expenses
    'target_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill, payment_method, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_target_start AND created_at < v_target_end
      ) e
    ),
    -- Previous day orders (for profit comparison)
    'yesterday_orders', (
      SELECT COALESCE(json_agg(o_row), '[]'::json)
      FROM (
        SELECT json_build_object(
          'id',         o.id,
          'total',      o.total,
          'total_cost', o.total_cost,
          'staff_name', o.staff_name,
          'deleted_at', o.deleted_at,
          'order_items', COALESCE((
            SELECT json_agg(json_build_object(
              'quantity',   oi.quantity,
              'product_id', oi.product_id,
              'unit_cost',  oi.unit_cost,
              'extra_ids',  oi.extra_ids
            ))
            FROM order_items oi WHERE oi.order_id = o.id
          ), '[]'::json)
        ) AS o_row
        FROM orders o
        WHERE o.address_id = p_address_id
          AND o.created_at >= v_prev_start AND o.created_at < v_prev_end
        ORDER BY o.created_at DESC
      ) sub
    ),
    -- Previous day expenses
    'yesterday_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill, payment_method, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_prev_start AND created_at < v_prev_end
      ) e
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_daily_report_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_report_by_date(UUID, DATE) TO authenticated;
