-- ==============================================================================================
-- Trả nợ NVL: lưu "Trong ca / Sau chốt ca" (cash_phase) trên TỪNG payment.
--
-- Trước giờ cash_phase chỉ nằm trong expenses.metadata (gắn lúc nhập kho) — report phân loại
-- MỌI payment theo cờ của hoá đơn gốc. Sai khi trả nợ vào ngày khác với phase khác (vd hoá đơn
-- nhập 'in_shift', 3 ngày sau trả nốt SAU chốt ca → vẫn bị cộng vào Thực thu của ngày trả).
-- UI InvoicePaymentSheet có sẵn toggle nhưng không gửi đi đâu (thiếu sót).
--
-- Fix:
--   1. expense_payments.cash_phase (NULL = phiếu cũ → report fallback cờ của hoá đơn, giữ số cũ).
--   2. record_invoice_payment nhận p_cash_phase (DROP signature cũ tránh overload ambiguity).
--      Kèm luôn fix so sánh NGÀY VN (20260612_fix_invoice_payment_same_day.sql) — file này
--      là bản FINAL của record_invoice_payment, chạy sau (hoặc thay) file fix đó đều được.
--   3. 3 report RPC trả thêm pp.cash_phase trong các mảng payments (copy 20260531 + 1 cột).
--
-- Client: reportStats ưu tiên p.cash_phase, fallback invoice_metadata.cash_phase.
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

-- ── 1. Cột cash_phase trên expense_payments ───────────────────────────────────
ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS cash_phase TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_cash_phase'
    ) THEN
        ALTER TABLE expense_payments ADD CONSTRAINT chk_payment_cash_phase
            CHECK (cash_phase IS NULL OR cash_phase IN ('in_shift', 'post_close'));
    END IF;
END $$;

-- ── 2. record_invoice_payment + p_cash_phase ──────────────────────────────────
-- DROP signature cũ: thêm param có default sẽ tạo OVERLOAD → PostgREST không chọn được hàm.
DROP FUNCTION IF EXISTS record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION record_invoice_payment(
    p_expense_id     UUID,
    p_amount         NUMERIC,
    p_payment_method TEXT DEFAULT 'cash',
    p_staff_name     TEXT DEFAULT NULL,
    p_paid_at        TIMESTAMPTZ DEFAULT NULL,
    p_cash_phase     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_id      UUID;
    v_invoice_amount  NUMERIC;
    v_invoice_created TIMESTAMPTZ;
    v_paid_total      NUMERIC;
    v_paid_at         TIMESTAMPTZ;
    v_cash_phase      TEXT;
    v_payment_id      UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
    END IF;

    -- NULL = không phân loại (phiếu cũ / caller cũ) → report fallback cờ hoá đơn.
    v_cash_phase := NULLIF(p_cash_phase, '');
    IF v_cash_phase IS NOT NULL AND v_cash_phase NOT IN ('in_shift', 'post_close') THEN
        RAISE EXCEPTION 'cash_phase must be in_shift | post_close (got %)', v_cash_phase;
    END IF;

    -- Lấy invoice (RLS sẽ chặn nếu caller không quyền access)
    SELECT address_id, amount, created_at
    INTO v_address_id, v_invoice_amount, v_invoice_created
    FROM expenses
    WHERE id = p_expense_id AND is_refill = true;

    IF v_address_id IS NULL THEN
        RAISE EXCEPTION 'invoice not found or not a refill';
    END IF;

    v_paid_at := COALESCE(p_paid_at, NOW());

    -- Chặn backdate sang trước NGÀY nhập (so theo ngày VN, không so timestamp:
    -- client neo paid_at = 12:00 trưa VN nên trả cùng ngày luôn hợp lệ).
    IF (v_paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         < (v_invoice_created AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before invoice date (%)',
            v_paid_at, (v_invoice_created AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    END IF;

    -- Chặn overpay: tổng đã trả + lần này không vượt invoice.amount.
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM expense_payments WHERE expense_id = p_expense_id;

    IF v_paid_total + p_amount > v_invoice_amount THEN
        RAISE EXCEPTION 'overpay: paid_total (% + %) would exceed invoice amount (%)',
            v_paid_total, p_amount, v_invoice_amount;
    END IF;

    INSERT INTO expense_payments (
        expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at, cash_phase
    ) VALUES (
        p_expense_id,
        v_address_id,
        p_amount,
        COALESCE(p_payment_method, 'cash'),
        p_staff_name,
        v_paid_at,
        v_paid_at,
        v_cash_phase
    ) RETURNING id INTO v_payment_id;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- ── 3. Report RPCs: trả thêm pp.cash_phase trong payments ─────────────────────
-- Body copy nguyên văn từ 20260531_order_discount.sql, chỉ thêm 1 cột pp.cash_phase
-- vào 6 subquery payments.
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
               pp.cash_phase,
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
               pp.cash_phase,
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
