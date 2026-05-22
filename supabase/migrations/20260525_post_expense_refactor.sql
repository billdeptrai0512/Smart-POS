-- Phase-2 follow-ups for the expense-categories refactor (20260525_expense_categories.sql).
--
-- 1. Unique index on expense_categories (address_id, lower(name)) for active rows
--    so concurrent inline-create can't produce duplicate tags.
--
-- 2. Patch the 3 report RPCs (get_daily_report_context, get_report_by_date,
--    get_report_by_range) to include `metadata` and `category_id` in the
--    expense SELECT lists. Without these, FinanceCards can't bucket expenses
--    by tag, and after-shift refill detection breaks.
--    Note: 20260521 inadvertently dropped `metadata` from
--    get_daily_report_context's SELECT — this migration also fixes that.
--
-- 3. Patch get_ingredient_stocks_v2 to walk shift_closings DESC and pick the
--    most-recent NON-NULL `remaining` per ingredient. Mirrors the JS fallback
--    fix in ingredientService.js — staff leaving "+ Cuối kỳ" blank no longer
--    resets next day's "Đầu kỳ" to 0.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Unique constraint on expense_categories
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_unique_name
    ON expense_categories (address_id, lower(name))
    WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2a. get_daily_report_context — add metadata + category_id
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
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at
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
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_yesterday AND created_at < v_today
      ) e
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2b. get_report_by_date — add category_id
-- ─────────────────────────────────────────────────────────────────────────────
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
        SELECT id, total, total_cost, payment_method, staff_name, created_at, deleted_at, deleted_by
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
          'id',             o.id,
          'total',          o.total,
          'total_cost',     o.total_cost,
          'payment_method', o.payment_method,
          'staff_name',     o.staff_name,
          'created_at',     o.created_at,
          'deleted_at',     o.deleted_at,
          'deleted_by',     o.deleted_by,
          'order_items',    COALESCE(ti.items, '[]'::json)
        ) ORDER BY o.created_at DESC
      ), '[]'::json)
      FROM target_orders o
      LEFT JOIN target_items ti ON ti.order_id = o.id
    ),
    'target_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_target_start AND created_at < v_target_end
      ) e
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
               payment_method, metadata, category_id, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_prev_start AND created_at < v_prev_end
      ) e
    )
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2c. get_report_by_range — add category_id
-- ─────────────────────────────────────────────────────────────────────────────
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
        SELECT id, total, total_cost, payment_method, staff_name, created_at, deleted_at, deleted_by
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
          'id',             o.id,
          'total',          o.total,
          'total_cost',     o.total_cost,
          'payment_method', o.payment_method,
          'staff_name',     o.staff_name,
          'created_at',     o.created_at,
          'deleted_at',     o.deleted_at,
          'deleted_by',     o.deleted_by,
          'order_items',    COALESCE(ti.items, '[]'::json)
        ) ORDER BY o.created_at DESC
      ), '[]'::json)
      FROM target_orders o
      LEFT JOIN target_items ti ON ti.order_id = o.id
    ),
    'target_expenses', (
      SELECT COALESCE(json_agg(e ORDER BY e.created_at ASC), '[]'::json)
      FROM (
        SELECT id, name, amount, staff_name, is_fixed, is_refill,
               payment_method, metadata, category_id, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= p_target_start AND created_at < p_target_end
      ) e
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
               payment_method, metadata, category_id, created_at
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= p_prev_start AND created_at < p_prev_end
      ) e
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_ingredient_stocks_v2 — counter carry-forward
-- ─────────────────────────────────────────────────────────────────────────────
-- Old logic: counter = remaining from THE single latest closing. If staff left
-- "+ Cuối kỳ" blank (stored as null since the JS update), counter became 0 →
-- next day's "Đầu kỳ" defaulted to 0.
--
-- New logic: walk ALL closings DESC and take the first non-null `remaining`
-- per ingredient. Mirrors JS fallback in ingredientService.js.
CREATE OR REPLACE FUNCTION get_ingredient_stocks_v2(p_address_id UUID)
RETURNS TABLE (
    ingredient TEXT,
    current_stock NUMERIC,
    restocked_qty NUMERIC,
    warehouse_stock NUMERIC,
    counter_stock NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_latest_report JSONB;
BEGIN
    -- Latest shift_closing inventory_report → today's restock per ingredient.
    -- (counter is computed separately via the DESC walk below.)
    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- today_restock = restock from the LATEST closing only.
    today_restock_cte AS (
        SELECT
            (elem->>'ingredient')::TEXT AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS today_restock
        FROM jsonb_array_elements(COALESCE(v_latest_report, '[]'::JSONB)) AS elem
        WHERE elem->>'ingredient' IS NOT NULL
    ),
    -- closings_with_remaining = (ingredient, remaining, created_at) for every
    -- inventory_report entry where `remaining` is NOT null. Walking this DESC
    -- and DISTINCT ON (ingredient) gives most-recent non-null per ingredient.
    closings_with_remaining AS (
        SELECT
            sc.created_at,
            (elem->>'ingredient')::TEXT AS ing,
            (elem->>'remaining')::NUMERIC AS remaining_val
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND elem ? 'remaining'
          AND elem->>'remaining' IS NOT NULL
          AND elem->>'ingredient' IS NOT NULL
    ),
    counter_cte AS (
        SELECT DISTINCT ON (ing)
            ing,
            remaining_val AS counter
        FROM closings_with_remaining
        ORDER BY ing, created_at DESC
    ),
    refill_cte AS (
        SELECT
            (e.metadata->>'ingredient')::TEXT AS ing,
            SUM(COALESCE((e.metadata->>'qty')::NUMERIC, 0)) AS total_refill,
            MIN(e.created_at) AS first_refill_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
        GROUP BY (e.metadata->>'ingredient')::TEXT
    ),
    closings_flat AS (
        SELECT
            sc.created_at,
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
    ),
    restock_cte AS (
        SELECT
            c.ing,
            SUM(c.restock) AS total_restock
        FROM closings_flat c
        JOIN refill_cte r ON r.ing = c.ing
        WHERE c.created_at >= r.first_refill_at
          AND c.ing IS NOT NULL
        GROUP BY c.ing
    ),
    all_keys AS (
        SELECT ing FROM counter_cte
        UNION
        SELECT ing FROM refill_cte
        UNION
        SELECT ing FROM restock_cte
        UNION
        SELECT ing FROM today_restock_cte
    )
    SELECT
        k.ing AS ingredient,
        (GREATEST(0, COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0)) + COALESCE(c.counter, 0))::NUMERIC AS current_stock,
        COALESCE(tr.today_restock, 0)::NUMERIC AS restocked_qty,
        GREATEST(0, COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0))::NUMERIC AS warehouse_stock,
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock
    FROM all_keys k
    LEFT JOIN counter_cte c ON c.ing = k.ing
    LEFT JOIN refill_cte r ON r.ing = k.ing
    LEFT JOIN restock_cte rs ON rs.ing = k.ing
    LEFT JOIN today_restock_cte tr ON tr.ing = k.ing;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ingredient_stocks_v2(UUID) TO authenticated;

COMMIT;
