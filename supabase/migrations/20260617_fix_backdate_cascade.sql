-- ==============================================================================================
-- Fix: Nhập kho backdate / hủy phiếu → tồn kho không cập nhật.
--
-- 3 BUG:
--   1. process_ingredient_restock: phiếu backdate (created_at quá khứ) có after_stock
--      nhưng nằm SAU các phiếu cũ hơn trong timeline → anchor_cte vẫn đọc neo CŨ
--      (phiếu có created_at mới nhất) → tồn kho không tăng.
--      FIX: sau INSERT, cascade cộng qty vào before_stock/after_stock của mọi phiếu
--      refill SAU phiếu backdate (cùng ingredient). Nhờ vậy phiếu neo mới nhất sẽ
--      có after_stock phản ánh đúng tổng nhập mới.
--
--   2. cancel_restock: zero-out qty nhưng GIỮ NGUYÊN after_stock trong metadata →
--      nếu phiếu hủy là neo mới nhất, anchor_cte đọc after_stock "chết" → tồn kho
--      không giảm. Không cascade trừ qty cho phiếu sau nếu hủy phiếu giữa timeline.
--      FIX: (a) xóa after_stock/before_stock khỏi metadata phiếu hủy,
--           (b) cascade trừ cancelled_qty cho mọi phiếu SAU.
--
--   3. get_ingredient_stocks_v2: anchor_cte không filter phiếu cancelled → phiếu hủy
--      vẫn được chọn làm neo.
--      FIX: thêm AND cancelled = false vào anchor_cte WHERE.
--
-- IDEMPOTENT — chạy lại an toàn (CREATE OR REPLACE).
-- ==============================================================================================

BEGIN;

-- ── 1. get_ingredient_stocks_v2 — filter cancelled khỏi anchor_cte ─────────────────────────────
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
    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL (quét mọi phiếu).
    counter_cte AS (
        SELECT DISTINCT ON (elem->>'ingredient')
            (elem->>'ingredient')::TEXT AS ing,
            (elem->>'remaining')::NUMERIC AS counter
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND elem->>'ingredient' IS NOT NULL
          AND elem->>'remaining' IS NOT NULL
        ORDER BY elem->>'ingredient', sc.created_at DESC
    ),
    -- "Nhập thêm hôm nay" — restock của riêng phiếu chốt mới nhất.
    today_cte AS (
        SELECT
            (elem->>'ingredient')::TEXT AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS today_restock
        FROM jsonb_array_elements(COALESCE(v_latest_report, '[]'::JSONB)) AS elem
        WHERE elem->>'ingredient' IS NOT NULL
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
    -- Công thức CŨ (fallback): Σ restock sau lần refill đầu.
    restock_cte AS (
        SELECT c.ing, SUM(c.restock) AS total_restock
        FROM closings_flat c
        JOIN refill_cte r ON r.ing = c.ing
        WHERE c.created_at >= r.first_refill_at
          AND c.ing IS NOT NULL
        GROUP BY c.ing
    ),
    -- MỐC NEO: phiếu nhập/hiệu chỉnh MỚI NHẤT có after_stock (chốt số kho tuyệt đối).
    -- FIX: filter loại phiếu đã cancelled — cancelled row giữ after_stock "chết".
    anchor_cte AS (
        SELECT DISTINCT ON (e.metadata->>'ingredient')
            (e.metadata->>'ingredient')::TEXT AS ing,
            (e.metadata->>'after_stock')::NUMERIC AS anchor_stock,
            e.created_at AS anchor_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
          AND e.metadata->>'after_stock' IS NOT NULL
          AND COALESCE((e.metadata->>'cancelled')::BOOLEAN, false) = false
        ORDER BY e.metadata->>'ingredient', e.created_at DESC
    ),
    -- Σ restock xảy ra SAU mốc neo.
    restock_since_anchor AS (
        SELECT a.ing, SUM(c.restock) AS total
        FROM closings_flat c
        JOIN anchor_cte a ON a.ing = c.ing
        WHERE c.created_at > a.anchor_at
        GROUP BY a.ing
    ),
    all_keys AS (
        SELECT ing FROM counter_cte
        UNION SELECT ing FROM today_cte
        UNION SELECT ing FROM refill_cte
        UNION SELECT ing FROM restock_cte
    ),
    -- Có mốc neo → kho = số neo − rút sau neo; chưa có → công thức cũ. Chặn sàn 0.
    warehouse_cte AS (
        SELECT
            k.ing,
            GREATEST(0, COALESCE(
                an.anchor_stock - COALESCE(rsa.total, 0),
                COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0)
            )) AS wh
        FROM all_keys k
        LEFT JOIN refill_cte           r   ON r.ing  = k.ing
        LEFT JOIN restock_cte          rs  ON rs.ing = k.ing
        LEFT JOIN anchor_cte           an  ON an.ing = k.ing
        LEFT JOIN restock_since_anchor rsa ON rsa.ing = k.ing
    )
    SELECT
        k.ing AS ingredient,
        (w.wh + COALESCE(c.counter, 0))::NUMERIC AS current_stock,
        COALESCE(t.today_restock, 0)::NUMERIC AS restocked_qty,
        w.wh::NUMERIC AS warehouse_stock,
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock
    FROM all_keys k
    LEFT JOIN warehouse_cte w ON w.ing = k.ing
    LEFT JOIN counter_cte   c ON c.ing = k.ing
    LEFT JOIN today_cte     t ON t.ing = k.ing;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ingredient_stocks_v2(UUID) TO authenticated;


-- ── 2. process_ingredient_restock — cascade after_stock khi backdate ────────────────────────────
CREATE OR REPLACE FUNCTION process_ingredient_restock(
    p_address_id    UUID,
    p_ingredient    TEXT,
    p_qty           NUMERIC,
    p_subtotal      NUMERIC,
    p_staff_name    TEXT,
    p_created_at    TIMESTAMPTZ DEFAULT NULL,
    p_discount      NUMERIC DEFAULT 0,
    p_extra_cost    NUMERIC DEFAULT 0,
    p_initial_payment NUMERIC DEFAULT NULL,
    p_payment_method TEXT DEFAULT 'cash',
    p_paid_at       TIMESTAMPTZ DEFAULT NULL,
    p_cash_phase    TEXT DEFAULT 'post_close'
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
    v_amount        NUMERIC;
    v_paid          NUMERIC;
    v_created_at    TIMESTAMPTZ;
    v_paid_at       TIMESTAMPTZ;
    v_before_stock  NUMERIC;
    v_after_stock   NUMERIC;
BEGIN
    -- Ownership guard (pattern 20260520/20260612). Skip service_role/migrations.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'discount cannot be negative (got %)', p_discount;
    END IF;
    IF COALESCE(p_extra_cost, 0) < 0 THEN
        RAISE EXCEPTION 'extra_cost cannot be negative (got %)', p_extra_cost;
    END IF;
    v_amount     := COALESCE(p_subtotal, 0) - COALESCE(p_discount, 0) + COALESCE(p_extra_cost, 0);
    IF v_amount < 0 THEN v_amount := 0; END IF;
    v_paid       := COALESCE(p_initial_payment, v_amount);
    IF v_paid < 0 THEN v_paid := 0; END IF;
    IF v_paid > v_amount THEN v_paid := v_amount; END IF;
    v_created_at := COALESCE(p_created_at, NOW());
    v_paid_at    := COALESCE(p_paid_at, v_created_at);
    IF v_paid_at < v_created_at - interval '1 minute' THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before created_at (%)', v_paid_at, v_created_at;
    END IF;

    -- 1. Tồn hiện tại (counter remaining từ shift_closing gần nhất) — cho WAC.
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

    -- Snapshot warehouse-side, NEO theo after_stock của phiếu gần nhất (đồng bộ với
    -- get_ingredient_stocks_v2): kho = số neo − Σ rút sau neo. Chưa có neo → công thức cũ.
    -- FIX: filter cancelled khỏi anchor (khớp với anchor_cte trong get_ingredient_stocks_v2).
    WITH anchor AS (
        SELECT (e.metadata->>'after_stock')::NUMERIC AS anchor_stock, e.created_at AS anchor_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND e.is_refill = true
          AND e.metadata->>'ingredient' = p_ingredient
          AND e.metadata->>'after_stock' IS NOT NULL
          AND COALESCE((e.metadata->>'cancelled')::BOOLEAN, false) = false
        ORDER BY e.created_at DESC
        LIMIT 1
    ),
    refills AS (
        SELECT created_at, COALESCE((metadata->>'qty')::NUMERIC, 0) AS qty
        FROM expenses
        WHERE address_id = p_address_id
          AND is_refill = true
          AND metadata->>'ingredient' = p_ingredient
    ),
    first_refill AS (
        SELECT MIN(created_at) AS first_at FROM refills WHERE qty IS NOT NULL
    ),
    restocks AS (
        SELECT sc.created_at, COALESCE((elem->>'restock')::NUMERIC, 0) AS qty
        FROM shift_closings sc, jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND (elem->>'ingredient')::TEXT = p_ingredient
    )
    SELECT ROUND(GREATEST(0,
        COALESCE(
            -- nhánh neo (chỉ khác NULL khi có phiếu lưu after_stock)
            (SELECT anchor_stock FROM anchor)
                - COALESCE((SELECT SUM(qty) FROM restocks
                            WHERE created_at > (SELECT anchor_at FROM anchor)), 0),
            -- fallback công thức cũ
            COALESCE((SELECT SUM(qty) FROM refills), 0)
                - COALESCE((SELECT SUM(qty) FROM restocks
                            WHERE created_at >= (SELECT first_at FROM first_refill)), 0)
        )
    )::numeric, 1)
    INTO v_before_stock;

    v_after_stock := ROUND(v_before_stock + COALESCE(p_qty, 0), 1);

    -- 2. Giá vốn hiện tại
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. WAC dùng v_amount
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + v_amount) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

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
            'new_unit_cost', v_new_unit_cost,
            'before_stock',  v_before_stock,
            'after_stock',   v_after_stock,
            'cash_phase',    COALESCE(NULLIF(p_cash_phase, ''), 'post_close')
        ),
        COALESCE(p_discount, 0),
        COALESCE(p_extra_cost, 0),
        v_created_at
    ) RETURNING id INTO v_expense_id;

    -- FIX: Cascade after_stock cho phiếu SAU khi backdate.
    -- Phiếu backdate nằm giữa timeline → các phiếu refill SAU nó cần +qty vào
    -- before_stock/after_stock để neo mới nhất phản ánh đúng tổng nhập.
    -- Chỉ cascade cho phiếu chưa bị hủy và có after_stock (= phiếu post-migration).
    UPDATE expenses SET
        metadata = jsonb_set(
            jsonb_set(
                metadata,
                '{before_stock}',
                to_jsonb(ROUND(
                    COALESCE((metadata->>'before_stock')::NUMERIC, 0) + p_qty,
                    1
                ))
            ),
            '{after_stock}',
            to_jsonb(ROUND(
                COALESCE((metadata->>'after_stock')::NUMERIC, 0) + p_qty,
                1
            ))
        )
    WHERE address_id = p_address_id
      AND is_refill = true
      AND metadata->>'ingredient' = p_ingredient
      AND metadata->>'after_stock' IS NOT NULL
      AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
      AND created_at > v_created_at
      AND id != v_expense_id;

    IF v_paid > 0 THEN
        INSERT INTO expense_payments (
            expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at
        ) VALUES (
            v_expense_id,
            p_address_id,
            v_paid,
            COALESCE(p_payment_method, 'cash'),
            p_staff_name,
            v_paid_at,
            v_paid_at
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
        'new_unit_cost', v_new_unit_cost,
        'before_stock',  v_before_stock,
        'after_stock',   v_after_stock
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;


-- ── 3. cancel_restock — cascade trừ qty + xóa after_stock phiếu hủy ────────────────────────────
CREATE OR REPLACE FUNCTION cancel_restock(
    p_address_id UUID,
    p_expense_id UUID,
    p_staff_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient      TEXT;
    v_qty             NUMERIC;
    v_amount          NUMERIC;
    v_meta            JSONB;
    v_is_refill       BOOLEAN;
    v_is_adjustment   BOOLEAN;
    v_already         BOOLEAN;
    v_total_qty       NUMERIC;
    v_total_cost      NUMERIC;
    v_new_unit_cost   NUMERIC;
    v_target_created  TIMESTAMPTZ;
BEGIN
    IF p_address_id IS NULL OR p_expense_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_expense_id are required';
    END IF;

    -- Ownership guard (mirrors process_ingredient_restock). Skip for service_role/migrations.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Load + validate. Lock the row so a concurrent cancel can't double-process.
    SELECT (metadata->>'ingredient')::TEXT,
           COALESCE((metadata->>'qty')::NUMERIC, 0),
           amount,
           metadata,
           is_refill,
           COALESCE((metadata->>'adjustment')::BOOLEAN, false),
           COALESCE((metadata->>'cancelled')::BOOLEAN, false),
           created_at
    INTO v_ingredient, v_qty, v_amount, v_meta, v_is_refill, v_is_adjustment, v_already, v_target_created
    FROM expenses
    WHERE id = p_expense_id AND address_id = p_address_id
    FOR UPDATE;

    IF v_ingredient IS NULL THEN
        RAISE EXCEPTION 'Entry % not found for address %', p_expense_id, p_address_id;
    END IF;
    IF NOT v_is_refill THEN
        RAISE EXCEPTION 'Entry % is not a restock/adjustment', p_expense_id;
    END IF;
    IF v_already THEN
        RAISE EXCEPTION 'Entry % is already cancelled', p_expense_id;
    END IF;

    -- 1. Zero-out the row in place + flag cancelled. Original numbers preserved in
    --    metadata so the card can still show the struck-through "+qty / -amount".
    --    FIX: xóa after_stock/before_stock (set null) để anchor_cte không đọc neo "chết".
    UPDATE expenses SET
        amount = 0,
        metadata = (v_meta - 'after_stock' - 'before_stock')
            || jsonb_build_object(
                'qty',              0,
                'cancelled',        true,
                'cancelled_at',     to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'cancelled_by',     p_staff_name,
                'cancelled_qty',    v_qty,
                'cancelled_amount', v_amount
            )
    WHERE id = p_expense_id AND address_id = p_address_id;

    -- FIX: Cascade trừ qty khỏi before_stock/after_stock của mọi phiếu refill SAU phiếu bị hủy.
    -- Khi hủy 1 phiếu ở giữa timeline, các phiếu sau cần giảm snapshot để neo mới nhất phản ánh
    -- đúng tồn kho thực tế (mất qty hộp đã hủy).
    IF v_qty != 0 THEN
        UPDATE expenses SET
            metadata = jsonb_set(
                jsonb_set(
                    metadata,
                    '{before_stock}',
                    to_jsonb(ROUND(
                        COALESCE((metadata->>'before_stock')::NUMERIC, 0) - v_qty,
                        1
                    ))
                ),
                '{after_stock}',
                to_jsonb(ROUND(
                    COALESCE((metadata->>'after_stock')::NUMERIC, 0) - v_qty,
                    1
                ))
            )
        WHERE address_id = p_address_id
          AND is_refill = true
          AND metadata->>'ingredient' = v_ingredient
          AND metadata->>'after_stock' IS NOT NULL
          AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
          AND created_at > v_target_created
          AND id != p_expense_id;
    END IF;

    -- 2. Reverse cash-out: drop the payments for this invoice.
    DELETE FROM expense_payments WHERE expense_id = p_expense_id;

    -- 3. Recompute WAC over the REMAINING real purchases (is_refill, not adjustment,
    --    amount > 0, NOT cancelled — the row above is now amount=0 so it self-excludes,
    --    but the explicit cancelled filter keeps intent clear).
    SELECT COALESCE(SUM(COALESCE((metadata->>'qty')::NUMERIC, 0)), 0),
           COALESCE(SUM(amount), 0)
    INTO v_total_qty, v_total_cost
    FROM expenses
    WHERE address_id = p_address_id AND is_refill = true
      AND metadata->>'ingredient' = v_ingredient
      AND COALESCE((metadata->>'adjustment')::BOOLEAN, false) = false
      AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
      AND amount > 0;

    IF v_total_qty > 0 THEN
        v_new_unit_cost := ROUND(v_total_cost / v_total_qty);
        UPDATE ingredient_costs SET unit_cost = v_new_unit_cost
        WHERE address_id = p_address_id AND ingredient = v_ingredient;
    ELSE
        v_new_unit_cost := NULL; -- no purchases left; leave unit_cost untouched
    END IF;

    RETURN jsonb_build_object(
        'success',        true,
        'ingredient',     v_ingredient,
        'cancelled_qty',  v_qty,
        'was_adjustment', v_is_adjustment,
        'new_unit_cost',  v_new_unit_cost
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) TO authenticated;


-- ── 4. edit_ingredient_restock — cascade delta và chỉ update record có after_stock ──────────
CREATE OR REPLACE FUNCTION edit_ingredient_restock(
    p_address_id      UUID,
    p_expense_id      UUID,
    p_qty             NUMERIC,
    p_subtotal        NUMERIC,
    p_discount        NUMERIC,
    p_extra_cost      NUMERIC,
    p_initial_payment NUMERIC,
    p_payment_method  TEXT,
    p_cash_phase      TEXT,
    p_created_at      TIMESTAMPTZ,
    p_staff_name      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient    TEXT;
    v_before_stock  NUMERIC;
    v_original_qty  NUMERIC;
    v_qty_delta     NUMERIC;
    v_meta          JSONB;
    v_is_refill     BOOLEAN;
    v_is_adjustment BOOLEAN;
    v_is_cancelled  BOOLEAN;
    v_amount        NUMERIC;
    v_paid          NUMERIC;
    v_paid_at       TIMESTAMPTZ;
    v_cash_phase    TEXT;
    v_after_stock   NUMERIC;
    v_total_qty     NUMERIC;
    v_total_cost    NUMERIC;
    v_new_unit_cost NUMERIC;
    v_payment_id    UUID;
    v_has_cash_phase_col BOOLEAN;
BEGIN
    IF p_address_id IS NULL OR p_expense_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_expense_id are required';
    END IF;

    -- Ownership guard (pattern 20260520/20260612). Skip service_role/migrations.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Load + lock row (concurrent edit/cancel cannot race).
    SELECT (metadata->>'ingredient')::TEXT,
           COALESCE((metadata->>'before_stock')::NUMERIC, 0),
           COALESCE((metadata->>'qty')::NUMERIC, 0),
           metadata,
           is_refill,
           COALESCE((metadata->>'adjustment')::BOOLEAN, false),
           COALESCE((metadata->>'cancelled')::BOOLEAN, false)
    INTO v_ingredient, v_before_stock, v_original_qty, v_meta,
         v_is_refill, v_is_adjustment, v_is_cancelled
    FROM expenses
    WHERE id = p_expense_id AND address_id = p_address_id
    FOR UPDATE;

    IF v_ingredient IS NULL THEN
        RAISE EXCEPTION 'Entry % not found for address %', p_expense_id, p_address_id;
    END IF;
    IF NOT v_is_refill THEN
        RAISE EXCEPTION 'Entry % is not a restock', p_expense_id;
    END IF;
    IF v_is_adjustment THEN
        RAISE EXCEPTION 'Cannot edit adjustment entry %', p_expense_id;
    END IF;
    IF v_is_cancelled THEN
        RAISE EXCEPTION 'Cannot edit cancelled entry %', p_expense_id;
    END IF;

    -- Validate input.
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'Quantity must be > 0 (got %)', p_qty;
    END IF;
    IF p_subtotal <= 0 THEN
        RAISE EXCEPTION 'Subtotal must be > 0 (got %)', p_subtotal;
    END IF;
    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'Discount cannot be negative (got %)', p_discount;
    END IF;
    IF COALESCE(p_extra_cost, 0) < 0 THEN
        RAISE EXCEPTION 'Extra cost cannot be negative (got %)', p_extra_cost;
    END IF;

    v_amount := p_subtotal - COALESCE(p_discount, 0) + COALESCE(p_extra_cost, 0);
    IF v_amount < 0 THEN v_amount := 0; END IF;

    -- [Fix 1] Prevent zero-amount rows — WAC query filters `amount > 0`, so a zero-amount
    -- row would add qty to stock while being silently excluded from WAC (undercount).
    IF v_amount <= 0 THEN
        RAISE EXCEPTION
            'Net amount must be > 0 (subtotal=%, discount=%, extra=%). Reduce discount.',
            p_subtotal, p_discount, p_extra_cost;
    END IF;

    v_paid := COALESCE(p_initial_payment, v_amount);
    IF v_paid < 0 THEN v_paid := 0; END IF;
    IF v_paid > v_amount THEN v_paid := v_amount; END IF;

    v_qty_delta   := p_qty - v_original_qty;
    v_after_stock := v_before_stock + p_qty;
    v_cash_phase  := NULLIF(COALESCE(p_cash_phase, ''), '');
    v_paid_at     := COALESCE(p_created_at, NOW());

    -- 1. UPDATE expense row (with audit trail).
    UPDATE expenses SET
        amount          = v_amount,
        discount_amount = COALESCE(p_discount, 0),
        extra_cost      = COALESCE(p_extra_cost, 0),
        payment_method  = p_payment_method,
        created_at      = COALESCE(p_created_at, created_at),
        metadata        = v_meta || jsonb_build_object(
            'qty',        p_qty,
            'subtotal',   p_subtotal,
            'cash_phase', COALESCE(v_cash_phase, 'post_close'),
            'after_stock', v_after_stock,
            -- [Impr] Audit trail: ai sửa + khi nào.
            'edited_at',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'edited_by',  p_staff_name
        )
    WHERE id = p_expense_id AND address_id = p_address_id;

    -- 2. [Impr] Delta cascade: khi qty thay đổi, shift before/after_stock của
    --    tất cả các phiếu refill TIẾP THEO (created_at > p_created_at) theo v_qty_delta.
    --    Mathematically correct khi withdrawals (shift_closings) không thay đổi.
    --    Adjustment rows được bỏ qua (amount=0, không ảnh hưởng WAC).
    --    FIX: Chỉ cascade cho các phiếu có sau migration có after_stock (tránh legacy records).
    IF v_qty_delta != 0 THEN
        UPDATE expenses SET
            metadata = jsonb_set(
                jsonb_set(
                    metadata,
                    '{before_stock}',
                    to_jsonb(ROUND(
                        COALESCE((metadata->>'before_stock')::NUMERIC, 0) + v_qty_delta,
                        1
                    ))
                ),
                '{after_stock}',
                to_jsonb(ROUND(
                    COALESCE((metadata->>'after_stock')::NUMERIC, 0) + v_qty_delta,
                    1
                ))
            )
        WHERE address_id = p_address_id
          AND is_refill = true
          AND metadata->>'ingredient' = v_ingredient
          AND metadata->>'after_stock' IS NOT NULL
          AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
          AND created_at > COALESCE(p_created_at, (
              SELECT created_at FROM expenses WHERE id = p_expense_id
          ));
    END IF;

    -- 3. Reconcile payments: DELETE + INSERT lại 1 payment = min(paid, amount).
    --    Đánh đổi: gộp nhiều lần trả thành 1 (chấp nhận cho v1, ghi chú ở đây).
    DELETE FROM expense_payments WHERE expense_id = p_expense_id;

    IF v_paid > 0 THEN
        -- [Fix 2] Check if cash_phase column exists before including it.
        --  If 20260612_invoice_payment_cash_phase.sql not yet applied, degrade gracefully.
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'expense_payments'
              AND column_name  = 'cash_phase'
        ) INTO v_has_cash_phase_col;

        IF v_has_cash_phase_col THEN
            INSERT INTO expense_payments (
                expense_id, address_id, amount, payment_method,
                staff_name, paid_at, created_at, cash_phase
            ) VALUES (
                p_expense_id, p_address_id, v_paid,
                COALESCE(p_payment_method, 'cash'),
                p_staff_name, v_paid_at, v_paid_at,
                COALESCE(v_cash_phase, 'post_close')
            ) RETURNING id INTO v_payment_id;
        ELSE
            INSERT INTO expense_payments (
                expense_id, address_id, amount, payment_method,
                staff_name, paid_at, created_at
            ) VALUES (
                p_expense_id, p_address_id, v_paid,
                COALESCE(p_payment_method, 'cash'),
                p_staff_name, v_paid_at, v_paid_at
            ) RETURNING id INTO v_payment_id;
        END IF;
    END IF;

    -- 4. Recompute WAC kiểu cancel_restock (full re-average — tất định).
    --    Query chạy SAU UPDATE nên row đang sửa đã có amount + qty mới.
    SELECT COALESCE(SUM(COALESCE((metadata->>'qty')::NUMERIC, 0)), 0),
           COALESCE(SUM(amount), 0)
    INTO v_total_qty, v_total_cost
    FROM expenses
    WHERE address_id = p_address_id
      AND is_refill = true
      AND metadata->>'ingredient' = v_ingredient
      AND COALESCE((metadata->>'adjustment')::BOOLEAN, false) = false
      AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
      AND amount > 0;

    IF v_total_qty > 0 THEN
        v_new_unit_cost := ROUND(v_total_cost / v_total_qty);
        UPDATE ingredient_costs
        SET unit_cost = v_new_unit_cost
        WHERE address_id = p_address_id AND ingredient = v_ingredient;

        -- Sync new_unit_cost vào metadata của row đang sửa (cho display).
        UPDATE expenses
        SET metadata = metadata || jsonb_build_object('new_unit_cost', v_new_unit_cost)
        WHERE id = p_expense_id AND address_id = p_address_id;
    ELSE
        v_new_unit_cost := NULL; -- no purchases left; leave unit_cost untouched
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'expense_id',    p_expense_id,
        'payment_id',    v_payment_id,
        'amount',        v_amount,
        'paid',          v_paid,
        'owing',         v_amount - v_paid,
        'qty_delta',     v_qty_delta,
        'new_unit_cost', v_new_unit_cost
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.edit_ingredient_restock(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.edit_ingredient_restock(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.edit_ingredient_restock(UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

COMMIT;
