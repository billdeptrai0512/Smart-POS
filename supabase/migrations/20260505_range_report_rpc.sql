-- =============================================
-- Consolidated RPC for RangeReportPage
-- Replaces 6 parallel calls on range view:
--   2x fetchShiftClosingsByRange + 2x fetchOrdersByRange + 2x fetchExpensesByRange
-- =============================================

CREATE OR REPLACE FUNCTION get_report_by_range(
  p_address_id UUID,
  p_target_start TIMESTAMPTZ,
  p_target_end TIMESTAMPTZ,
  p_prev_start TIMESTAMPTZ,
  p_prev_end TIMESTAMPTZ
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
BEGIN
  RETURN json_build_object(
    -- Target date orders (full structure for aggregation)
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
          AND o.created_at >= p_target_start AND o.created_at < p_target_end
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
          AND created_at >= p_target_start AND created_at < p_target_end
      ) e
    ),
    -- Target date shift closings
    'target_shift_closings', (
      SELECT COALESCE(json_agg(sc_row ORDER BY sc_row.closed_at DESC), '[]'::json)
      FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= p_target_start AND closed_at < p_target_end
      ) sc_row
    ),
    -- Previous period orders (for profit comparison)
    'prev_orders', (
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
          AND o.created_at >= p_prev_start AND o.created_at < p_prev_end
        ORDER BY o.created_at DESC
      ) sub
    ),
    -- Previous period expenses
    'prev_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill, payment_method, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= p_prev_start AND created_at < p_prev_end
      ) e
    ),
    -- Previous period shift closings
    'prev_shift_closings', (
      SELECT COALESCE(json_agg(sc_row ORDER BY sc_row.closed_at DESC), '[]'::json)
      FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= p_prev_start AND closed_at < p_prev_end
      ) sc_row
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_report_by_range(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
