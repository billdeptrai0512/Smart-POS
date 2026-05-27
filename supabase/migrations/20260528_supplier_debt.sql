-- Công nợ NVL: tách "invoice" (nghĩa vụ phải trả) khỏi "payment" (cash-out thực).
--
-- Trước đây mỗi lần Nhập kho (RestockModal) → tạo 1 expense `is_refill=true` đồng thời
-- ghi nhận luôn là cash-out tại `created_at`. Điều này đúng khi quán trả ngay, nhưng sai
-- khi quán đi chợ ghi nợ (tiền thật chưa ra). Sau migration này:
--
--   expenses(is_refill=true)        = INVOICE (nghĩa vụ + qty + WAC anchor)
--   expense_payments(expense_id=X)  = từng lần trả (cash-out thực sự, theo paid_at)
--
-- Trạng thái nợ derived:
--   paid_total = SUM(expense_payments.amount WHERE expense_id = invoice.id)
--   status: paid (paid=amount) / partial (0<paid<amount) / unpaid (paid=0)
--
-- Cashflow theo ngày X (cho refill):
--   SUM(expense_payments.amount WHERE paid_at ∈ day X) group by payment_method.
-- Refill expense với paid_total < amount → phần chưa trả KHÔNG vào cashflow.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Mở rộng expenses: discount + extra cost cho invoice refill
-- ─────────────────────────────────────────────────────────────────────────────
-- `amount` luôn = Cần trả NCC = subtotal − discount + extra_cost. WAC dùng amount này.
-- Hai cột mới chỉ phản ánh cấu thành để hiển thị lại trên UI (không vào công thức kho).
ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS discount_amount NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS extra_cost      NUMERIC NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Bảng expense_payments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id      UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    address_id      UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    amount          NUMERIC NOT NULL CHECK (amount > 0),
    payment_method  TEXT NOT NULL DEFAULT 'cash',
    staff_name      TEXT,
    paid_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- paid_at không được rơi trước thời điểm tạo row (1 phút buffer cho clock skew).
    -- Caller cần đảm bảo paid_at >= invoice.created_at — kiểm thêm ở RPC.
    CONSTRAINT chk_payment_paid_at_not_before_created
        CHECK (paid_at >= created_at - interval '1 minute')
);

CREATE INDEX IF NOT EXISTS idx_expense_payments_expense
    ON expense_payments (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_payments_address_paid_at
    ON expense_payments (address_id, paid_at);

-- RLS: same pattern as `expenses`
ALTER TABLE expense_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_expense_payments" ON expense_payments;
CREATE POLICY "managers_expense_payments" ON expense_payments
    FOR ALL USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid() OR u.id IN (
                SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON expense_payments TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. process_ingredient_restock — thêm discount/extra/initial_payment
-- ─────────────────────────────────────────────────────────────────────────────
-- p_subtotal     : Tổng tiền hàng (giá × qty trước giảm)
-- p_discount     : Giảm giá (đã quy ra VND, không phân biệt % hay tiền)
-- p_extra_cost   : Chi phí nhập (ship, vận chuyển, …)
-- p_initial_payment : Số tiền trả ngay tại thời điểm nhập (0 = ghi nợ hoàn toàn)
-- p_payment_method  : 'cash' | 'transfer' cho expense_payments row tạo kèm
-- p_paid_at      : Thời điểm trả ngay (default = p_created_at hoặc NOW)
-- p_created_at   : Ngày nhập kho (giữ từ migration trước)
--
-- WAC dùng `amount = subtotal − discount + extra_cost` (chi phí thực).
--
-- Trước khi recreate, drop tất cả overload cũ để PG không bị "function is not unique"
-- khi FE truyền tập tham số có thể match nhiều version.
DROP FUNCTION IF EXISTS process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION process_ingredient_restock(
    p_address_id    UUID,
    p_ingredient    TEXT,
    p_qty           NUMERIC,
    p_subtotal      NUMERIC,
    p_staff_name    TEXT,
    p_created_at    TIMESTAMPTZ DEFAULT NULL,
    p_discount      NUMERIC DEFAULT 0,
    p_extra_cost    NUMERIC DEFAULT 0,
    p_initial_payment NUMERIC DEFAULT NULL,   -- NULL = trả full mặc định (backward-compat)
    p_payment_method TEXT DEFAULT 'cash',
    p_paid_at       TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_stock NUMERIC;
    v_old_unit_cost NUMERIC;
    v_new_unit_cost NUMERIC;
    v_expense_id    UUID;
    v_payment_id    UUID;
    v_display_name  TEXT;
    v_amount        NUMERIC;    -- Cần trả NCC
    v_paid          NUMERIC;
    v_created_at    TIMESTAMPTZ;
BEGIN
    -- Chặn input âm sớm — discount/extra_cost âm sẽ bóp méo amount.
    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'discount cannot be negative (got %)', p_discount;
    END IF;
    IF COALESCE(p_extra_cost, 0) < 0 THEN
        RAISE EXCEPTION 'extra_cost cannot be negative (got %)', p_extra_cost;
    END IF;
    v_amount     := COALESCE(p_subtotal, 0) - COALESCE(p_discount, 0) + COALESCE(p_extra_cost, 0);
    IF v_amount < 0 THEN v_amount := 0; END IF;
    -- Default initial_payment = full khi caller cũ không truyền → giữ behavior trả ngay.
    v_paid       := COALESCE(p_initial_payment, v_amount);
    IF v_paid < 0 THEN v_paid := 0; END IF;
    IF v_paid > v_amount THEN v_paid := v_amount; END IF;
    v_created_at := COALESCE(p_created_at, NOW());
    -- paid_at default = created_at để CHECK constraint không vướng khi user backdate purchaseDate.
    IF p_paid_at IS NOT NULL AND p_paid_at < v_created_at - interval '1 minute' THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before created_at (%)', p_paid_at, v_created_at;
    END IF;

    -- 1. Tồn hiện tại (lấy remaining từ shift_closing gần nhất)
    SELECT COALESCE(
        (SELECT (elem->>'remaining')::NUMERIC
         FROM jsonb_array_elements(inventory_report) AS elem
         WHERE (elem->>'ingredient')::TEXT = p_ingredient
         LIMIT 1),
        0
    )
    INTO v_current_stock
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_current_stock IS NULL OR v_current_stock < 0 THEN v_current_stock := 0; END IF;

    -- 2. Giá vốn hiện tại
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. WAC dùng v_amount (đã trừ discount + cộng extra_cost)
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + v_amount) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    -- 4. Display name từ ingredient key
    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

    -- 5. INVOICE (expenses row)
    INSERT INTO expenses (
        address_id, name, amount, is_fixed, is_refill, payment_method,
        staff_name, metadata, discount_amount, extra_cost, created_at
    ) VALUES (
        p_address_id,
        v_display_name,
        v_amount,
        false,
        true,
        p_payment_method,
        p_staff_name,
        jsonb_build_object(
            'ingredient',    p_ingredient,
            'qty',           p_qty,
            'subtotal',      p_subtotal,
            'old_unit_cost', v_old_unit_cost,
            'new_unit_cost', v_new_unit_cost
        ),
        COALESCE(p_discount, 0),
        COALESCE(p_extra_cost, 0),
        v_created_at
    ) RETURNING id INTO v_expense_id;

    -- 6. PAYMENT (chỉ tạo khi trả > 0)
    IF v_paid > 0 THEN
        INSERT INTO expense_payments (
            expense_id, address_id, amount, payment_method, staff_name, paid_at
        ) VALUES (
            v_expense_id,
            p_address_id,
            v_paid,
            COALESCE(p_payment_method, 'cash'),
            p_staff_name,
            COALESCE(p_paid_at, v_created_at)
        ) RETURNING id INTO v_payment_id;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'expense_id',    v_expense_id,
        'payment_id',    v_payment_id,
        'amount',        v_amount,
        'paid',          v_paid,
        'owing',         v_amount - v_paid,
        'old_unit_cost', v_old_unit_cost,
        'new_unit_cost', v_new_unit_cost
    );
END;
$$;

GRANT EXECUTE ON FUNCTION process_ingredient_restock(
    UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ
) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. record_invoice_payment — ghi nhận lần trả nợ riêng cho invoice đã tồn tại
-- ─────────────────────────────────────────────────────────────────────────────
-- Caller tự đảm bảo p_amount ≤ owing còn lại (FE pre-validate). Server không lock —
-- worst case overpay sẽ hiển thị âm "Còn nợ", manager tự sửa.
CREATE OR REPLACE FUNCTION record_invoice_payment(
    p_expense_id     UUID,
    p_amount         NUMERIC,
    p_payment_method TEXT DEFAULT 'cash',
    p_staff_name     TEXT DEFAULT NULL,
    p_paid_at        TIMESTAMPTZ DEFAULT NULL
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
    v_payment_id      UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
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

    -- Chặn backdate sang trước ngày nhập (kế toán bug). Buffer 1 phút cho clock skew.
    IF v_paid_at < v_invoice_created - interval '1 minute' THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before invoice created_at (%)', v_paid_at, v_invoice_created;
    END IF;

    -- Chặn overpay: tổng đã trả + lần này không vượt invoice.amount.
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM expense_payments WHERE expense_id = p_expense_id;

    IF v_paid_total + p_amount > v_invoice_amount THEN
        RAISE EXCEPTION 'overpay: paid_total (% + %) would exceed invoice amount (%)',
            v_paid_total, p_amount, v_invoice_amount;
    END IF;

    INSERT INTO expense_payments (
        expense_id, address_id, amount, payment_method, staff_name, paid_at
    ) VALUES (
        p_expense_id,
        v_address_id,
        p_amount,
        COALESCE(p_payment_method, 'cash'),
        p_staff_name,
        v_paid_at
    ) RETURNING id INTO v_payment_id;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Report RPCs — attach `target_payments` để cashflow tính theo paid_at
-- ─────────────────────────────────────────────────────────────────────────────
-- Refill expenses vẫn được fetch như cũ để hiển thị Tab Nhập kho, "Nguyên vật liệu"
-- panel của CashFlowCard. Nhưng cash-out tiền mặt/chuyển khoản phải tính từ payments.
-- FE tự switch logic (đọc payments thay vì refill expenses).

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
               payment_method, metadata, category_id, created_at,
               discount_amount, extra_cost
        FROM expenses
        WHERE address_id = p_address_id
          AND created_at >= v_today
      ) e
    ),
    'target_payments', (
      -- Nest invoice_name/metadata để FE dùng cho panel Nguyên vật liệu kể cả khi
      -- trả nợ cho invoice thuộc ngày khác (không nằm trong target_expenses).
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Migration data: cho refill expenses cũ tự sinh 1 expense_payments tương ứng
--    (giả định toàn bộ đã trả ngay khi insert — đúng với hành vi trước migration này).
--    Giúp cashflow lịch sử KHÔNG bị thiếu cash-out sau khi FE chuyển sang đọc payments.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO expense_payments (expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at)
SELECT
    e.id,
    e.address_id,
    e.amount,
    COALESCE(e.payment_method, 'cash'),
    e.staff_name,
    e.created_at,
    e.created_at
FROM expenses e
WHERE e.is_refill = true
  AND e.amount > 0
  -- Skip template/playground refill (address_id NULL) — không phải dữ liệu kế toán thật,
  -- và FK expense_payments.address_id là NOT NULL.
  AND e.address_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM expense_payments ep WHERE ep.expense_id = e.id
  )
  -- adjustment rows (kiểm kê) có amount=0 → đã skip ở e.amount > 0
  AND COALESCE((e.metadata->>'adjustment')::BOOLEAN, false) = false;

COMMIT;
