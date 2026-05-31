-- =============================================================================
-- Per-order discount tracking
-- =============================================================================
-- POS can apply a per-order discount (%/đ). Until now only the discounted
-- `total` (net) was stored, so the P&L "Giảm giá" line was always 0 and
-- "Bán hàng" showed net revenue. Persist the discount on each order so reports
-- can show gross "Bán hàng" = total + discount_amount, "Giảm giá", and keep
-- "Doanh thu thuần" = total (net, unchanged → profit math is untouched).
--
-- `total` semantics are unchanged (still net). discount_amount only ever > 0 on
-- orders created after this migration; historical rows default to 0.
-- =============================================================================

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Write path: bulk_create_orders now reads discount_amount from the payload.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bulk_create_orders(orders_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_rec JSONB;
  item_rec JSONB;
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
BEGIN
  FOR order_rec IN SELECT * FROM jsonb_array_elements(orders_payload)
  LOOP
    -- use provided created_at if exists, else now()
    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());

    INSERT INTO orders (total, total_cost, discount_amount, payment_method, address_id, staff_name, created_at)
    VALUES (
      (order_rec->>'total')::INTEGER,
      COALESCE((order_rec->>'total_cost')::INTEGER, 0),
      COALESCE((order_rec->>'discount_amount')::INTEGER, 0),
      order_rec->>'payment_method',
      (order_rec->>'address_id')::UUID,
      order_rec->>'staff_name',
      new_order_time
    )
    RETURNING id INTO new_order_id;

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      INSERT INTO order_items (order_id, product_id, quantity, options, unit_cost, extra_ids)
      VALUES (
        new_order_id,
        (item_rec->>'product_id')::UUID,
        (item_rec->>'quantity')::INTEGER,
        item_rec->>'options',
        COALESCE((item_rec->>'unit_cost')::INTEGER, 0),
        COALESCE(item_rec->'extra_ids', '[]'::JSONB)::UUID[]
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Read path: add discount_amount to the target_orders JSON of each report RPC.
-- Bodies are copied verbatim from 20260528_supplier_debt.sql with that single
-- field added; comparison rows (yesterday_orders / prev_orders) are left as-is
-- since the period delta is computed on net total.
-- ─────────────────────────────────────────────────────────────────────────────
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
               actual_cash, actual_transfer, system_total_revenue
        FROM shift_closings
        WHERE address_id = p_address_id
          AND closed_at >= v_target_start AND closed_at < v_target_end
        ORDER BY closed_at DESC LIMIT 1
      ) sc
    ),
    'yesterday_closing', (
      SELECT row_to_json(sc) FROM (
        SELECT id, closed_at, address_id, inventory_report,
               actual_cash, actual_transfer, system_total_revenue
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
    'target_orders', (
      WITH target_orders AS (
        SELECT id, total, total_cost, discount_amount, payment_method, staff_name, created_at, deleted_at, deleted_by
        FROM orders
        WHERE address_id = p_address_id
          AND created_at >= p_target_start AND created_at < p_target_end
          AND deleted_at IS NULL
      ),
      target_items AS (
        SELECT oi.order_id, json_agg(json_build_object(
          'quantity',   oi.quantity,
          'product_id', oi.product_id,
          'unit_cost',  oi.unit_cost,
          'extra_ids',  oi.extra_ids
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
          AND created_at >= p_target_start AND created_at < p_target_end
      ) e
    ),
    'target_payments', (
      SELECT COALESCE(json_agg(p ORDER BY p.paid_at ASC), '[]'::json)
      FROM (
        SELECT pp.id, pp.expense_id, pp.amount, pp.payment_method, pp.staff_name, pp.paid_at,
               ee.name AS invoice_name, ee.metadata AS invoice_metadata
        FROM expense_payments pp
        LEFT JOIN expenses ee ON ee.id = pp.expense_id
        WHERE pp.address_id = p_address_id
          AND pp.paid_at >= p_target_start AND pp.paid_at < p_target_end
      ) p
    ),
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
    'prev_orders', (
      WITH prev_orders AS (
        SELECT id, total, total_cost, created_at, deleted_at
        FROM orders
        WHERE address_id = p_address_id
          AND created_at >= p_prev_start AND created_at < p_prev_end
          AND deleted_at IS NULL
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
          'deleted_at', o.deleted_at,
          'order_items', COALESCE(pi.items, '[]'::json)
        ) ORDER BY o.created_at DESC
      ), '[]'::json)
      FROM prev_orders o
      LEFT JOIN prev_items pi ON pi.order_id = o.id
    ),
    'prev_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at,
               discount_amount, extra_cost
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= p_prev_start AND created_at < p_prev_end
      ) e
    ),
    'prev_payments', (
      SELECT COALESCE(json_agg(p ORDER BY p.paid_at ASC), '[]'::json)
      FROM (
        SELECT pp.id, pp.expense_id, pp.amount, pp.payment_method, pp.staff_name, pp.paid_at,
               ee.name AS invoice_name, ee.metadata AS invoice_metadata
        FROM expense_payments pp
        LEFT JOIN expenses ee ON ee.id = pp.expense_id
        WHERE pp.address_id = p_address_id
          AND pp.paid_at >= p_prev_start AND pp.paid_at < p_prev_end
      ) p
    ),
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

GRANT EXECUTE ON FUNCTION get_daily_report_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_report_by_date(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_report_by_range(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

COMMIT;
