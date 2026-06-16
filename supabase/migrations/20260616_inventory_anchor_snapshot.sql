-- ==============================================================================================
-- Kho NEO theo snapshot (chống trôi số "Tồn kho").
--
-- BUG: warehouse = Σ(refill.qty) − Σ(restock) là tổng cộng-dồn KHÔNG chặn sàn giữa chừng.
--   • Phiếu "Hiệu chỉnh tồn" (kiểm kê) được lưu dạng +delta rồi cộng vào tổng → khi kho đã
--     trôi âm (rút quá tay) thì delta đó vừa reset-hiển-thị (clamp 0) VỪA cộng vào tổng →
--     đếm đôi. Hệ quả: thẻ "Rút ra quầy" và get_ingredient_stocks_v2 ra số kho phồng lên
--     (vd sữa_đặc: rút 2568 hiện "5136 → 2568" thay vì "2568 → 0").
--   • Vì warehouse sai → tab "Soạn cho hôm nay" / "Chuẩn bị tồn kho" cũng sai theo.
--
-- FIX: mỗi phiếu nhập/hiệu chỉnh đã lưu `after_stock` (từ 20260529) = "chốt số kho" tuyệt đối
--   tại thời điểm đó. Dùng phiếu có after_stock MỚI NHẤT làm MỐC NEO:
--       warehouse = after_stock(neo) − Σ(restock SAU thời điểm neo)
--   Một lần kiểm kê/nhập kho trở thành mốc tuyệt đối → không cộng đôi, không tích lũy sai số
--   kho âm/hiệu chỉnh trước đó. Chưa có phiếu nào lưu after_stock (dữ liệu trước 20260529)
--   → fallback đúng công thức cũ (Σrefill − Σrestock sau lần refill đầu). Khớp 1-1 với JS:
--   fetchIngredientWithdrawals (thẻ) + fetchIngredientStocks (fallback).
--
-- Theo CLAUDE.md: cả 2 hàm GIỮ search_path=public; process_ingredient_restock GIỮ ownership
-- guard (pattern 20260520/20260612); chữ ký KHÔNG đổi nên kèm lại REVOKE/GRANT cho chắc.
-- ==============================================================================================

BEGIN;

-- ── 1. get_ingredient_stocks_v2 — warehouse NEO theo after_stock ───────────────────────────────
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


-- ── 2. process_ingredient_restock — before_stock NEO theo after_stock ───────────────────────────
-- Body = 20260612_security_advisor_fixes (guard + cash_phase) — CHỈ đổi khối tính v_before_stock
-- sang công thức neo, để snapshot phiếu nhập mới khớp với get_ingredient_stocks_v2.
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
    WITH anchor AS (
        SELECT (e.metadata->>'after_stock')::NUMERIC AS anchor_stock, e.created_at AS anchor_at
        FROM expenses e
        WHERE e.address_id = p_address_id
          AND e.is_refill = true
          AND e.metadata->>'ingredient' = p_ingredient
          AND e.metadata->>'after_stock' IS NOT NULL
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

COMMIT;
