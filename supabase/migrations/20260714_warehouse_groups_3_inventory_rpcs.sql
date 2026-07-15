-- ==============================================================================================
-- Kho tổng dùng chung nhiều địa chỉ — Phase 3: làm 4 RPC tồn kho hiện có nhận biết nhóm.
--
-- CHỮ KÝ KHÔNG ĐỔI trên cả 4 hàm → không cần REVOKE/GRANT (chỉ bắt buộc khi đổi signature theo
-- CLAUDE.md), nhưng vẫn khai lại SET search_path=public + giữ nguyên ownership guard.
--
-- Nguyên tắc:
--   - Kho tổng (refill + restock rút từ kho tổng): mở rộng sang cả nhóm qua
--     get_warehouse_group_address_ids(p_address_id).
--   - Quầy (counter, remaining đếm tay): GIỮ NGUYÊN scope theo p_address_id — không pool.
--   - Anchor snapshot (before/after_stock) chỉ đúng trên timeline 1 địa chỉ → khi địa chỉ thuộc
--     nhóm > 1 thành viên, get_ingredient_stocks_v2 BỎ QUA anchor, luôn dùng công thức fallback
--     (Σrefill − Σrestock) nhưng tính trên cả nhóm. Cascade before/after_stock trong 3 RPC ghi
--     GIỮ NGUYÊN scope theo p_address_id (không cần sửa — vẫn hợp lệ nếu địa chỉ rời nhóm sau này).
--   - WAC: process_ingredient_restock giữ nguyên mô hình moving-average riêng (dùng tồn quầy hiện
--     tại của p_address_id — tech debt đã biết, KHÔNG đồng bộ theo cancel_restock, ngoài phạm vi).
--     cancel_restock/edit_ingredient_restock dùng recompute_group_unit_cost (full re-average trên
--     cả nhóm). Cả 3 hàm ghi WAC qua sync_group_unit_cost/recompute_group_unit_cost để fan-out.
-- ==============================================================================================

BEGIN;

-- ── 1. get_ingredient_stocks_v2 — kho tổng mở rộng theo nhóm, bỏ anchor khi grouped ────────────
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
    v_group_ids     UUID[];
BEGIN
    v_group_ids := public.get_warehouse_group_address_ids(p_address_id);

    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL — QUẦY, không pool, chỉ p_address_id.
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
    -- "Nhập thêm hôm nay" — riêng của địa chỉ này, không pool.
    today_cte AS (
        SELECT
            (elem->>'ingredient')::TEXT AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS today_restock
        FROM jsonb_array_elements(COALESCE(v_latest_report, '[]'::JSONB)) AS elem
        WHERE elem->>'ingredient' IS NOT NULL
    ),
    -- KHO TỔNG: mua hàng ở BẤT KỲ địa chỉ nào trong nhóm đều cộng vào cùng pool.
    refill_cte AS (
        SELECT
            (e.metadata->>'ingredient')::TEXT AS ing,
            SUM(COALESCE((e.metadata->>'qty')::NUMERIC, 0)) AS total_refill,
            MIN(e.created_at) AS first_refill_at
        FROM expenses e
        WHERE e.address_id = ANY(v_group_ids)
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
        GROUP BY (e.metadata->>'ingredient')::TEXT
    ),
    -- Rút ra quầy ở BẤT KỲ địa chỉ nào trong nhóm đều trừ vào cùng pool.
    closings_flat AS (
        SELECT
            sc.created_at,
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = ANY(v_group_ids)
          AND sc.inventory_report IS NOT NULL
    ),
    -- Công thức CŨ (fallback): Σ restock sau lần refill đầu — nay tính trên cả nhóm.
    restock_cte AS (
        SELECT c.ing, SUM(c.restock) AS total_restock
        FROM closings_flat c
        JOIN refill_cte r ON r.ing = c.ing
        WHERE c.created_at >= r.first_refill_at
          AND c.ing IS NOT NULL
        GROUP BY c.ing
    ),
    -- MỐC NEO: chỉ áp dụng khi địa chỉ KHÔNG thuộc nhóm > 1 thành viên (anchor chỉ đúng trên
    -- timeline 1 địa chỉ — cộng dồn qua nhiều địa chỉ là vô nghĩa). Grouped → CTE rỗng → fallback.
    anchor_cte AS (
        SELECT DISTINCT ON (e.metadata->>'ingredient')
            (e.metadata->>'ingredient')::TEXT AS ing,
            (e.metadata->>'after_stock')::NUMERIC AS anchor_stock,
            e.created_at AS anchor_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND array_length(v_group_ids, 1) = 1
          AND e.is_refill = true
          AND e.metadata->>'ingredient' IS NOT NULL
          AND e.metadata->>'after_stock' IS NOT NULL
          AND COALESCE((e.metadata->>'cancelled')::BOOLEAN, false) = false
        ORDER BY e.metadata->>'ingredient', e.created_at DESC
    ),
    -- Σ restock xảy ra SAU mốc neo (chỉ có ý nghĩa khi anchor_cte khác rỗng, tức ungrouped).
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
    -- Có mốc neo (chỉ ungrouped) → kho = số neo − rút sau neo; còn lại → công thức cũ trên nhóm.
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


-- ── 2. process_ingredient_restock — WAC ghi qua sync_group_unit_cost (fan-out khi có nhóm) ─────
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

    -- 1. Tồn hiện tại (counter remaining từ shift_closing gần nhất CỦA p_address_id) — cho WAC.
    --    Mô hình moving-average này dùng tồn QUẦY riêng của p_address_id, không pool theo nhóm —
    --    tech debt đã biết (task.md), KHÔNG đồng bộ theo cancel_restock, ngoài phạm vi thay đổi này.
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

    -- Snapshot warehouse-side (before/after_stock) — GIỮ NGUYÊN scope p_address_id, không pool
    -- (anchor chỉ đúng trên timeline 1 địa chỉ; get_ingredient_stocks_v2 tự bỏ qua khi grouped).
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

    -- 2. Giá vốn hiện tại — đọc theo p_address_id, ĐÚNG nhờ bất biến "đã fan-out" (mọi thành viên
    --    trong nhóm luôn có cùng unit_cost sau mỗi lần ghi qua sync_group_unit_cost).
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

    -- Fan-out ra mọi thành viên trong nhóm (no-op ngoài chính p_address_id nếu ungrouped).
    PERFORM public.sync_group_unit_cost(p_address_id, p_ingredient, v_new_unit_cost);

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

    -- Cascade after_stock cho phiếu SAU khi backdate — GIỮ NGUYÊN scope p_address_id.
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


-- ── 3. cancel_restock — WAC recompute qua recompute_group_unit_cost (full re-average / nhóm) ───
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
    --    xóa after_stock/before_stock (set null) để anchor_cte không đọc neo "chết".
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

    -- Cascade trừ qty khỏi before_stock/after_stock của mọi phiếu refill SAU phiếu bị hủy —
    -- GIỮ NGUYÊN scope p_address_id (anchor snapshot chỉ đúng trên timeline 1 địa chỉ).
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

    -- 3. Recompute WAC — full re-average trên CẢ NHÓM (no-op mở rộng nếu ungrouped), fan-out kết quả.
    v_new_unit_cost := public.recompute_group_unit_cost(p_address_id, v_ingredient);

    RETURN jsonb_build_object(
        'success',        true,
        'ingredient',     v_ingredient,
        'cancelled_qty',  v_qty,
        'was_adjustment', v_is_adjustment,
        'new_unit_cost',  v_new_unit_cost
    );
END;
$$;


-- ── 4. edit_ingredient_restock — WAC recompute qua recompute_group_unit_cost (nhóm) ─────────────
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

    -- Prevent zero-amount rows — WAC query filters `amount > 0`, so a zero-amount
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
            'edited_at',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'edited_by',  p_staff_name
        )
    WHERE id = p_expense_id AND address_id = p_address_id;

    -- 2. Delta cascade: khi qty thay đổi, shift before/after_stock của tất cả các phiếu refill
    --    TIẾP THEO — GIỮ NGUYÊN scope p_address_id (anchor chỉ đúng trên timeline 1 địa chỉ).
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
        -- Check if cash_phase column exists before including it.
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

    -- 4. Recompute WAC — full re-average trên CẢ NHÓM (no-op mở rộng nếu ungrouped), fan-out.
    --    Query chạy SAU UPDATE nên row đang sửa đã có amount + qty mới.
    v_new_unit_cost := public.recompute_group_unit_cost(p_address_id, v_ingredient);

    IF v_new_unit_cost IS NOT NULL THEN
        -- Sync new_unit_cost vào metadata của row đang sửa (cho display).
        UPDATE expenses
        SET metadata = metadata || jsonb_build_object('new_unit_cost', v_new_unit_cost)
        WHERE id = p_expense_id AND address_id = p_address_id;
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

COMMIT;
