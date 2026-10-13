-- Kho tổng được phép ÂM (nợ kho): nhân viên "Nhập thêm" (rút ra quầy) vượt tồn kho khi quản lý quên ghi
-- lần nhập → kho = -1, quản lý nhập bù sau thì kho tự về đúng.
-- Hai chỗ trước đây kẹp ≥0 làm mất số nợ:
--   1. get_ingredient_stocks_v2: warehouse_cte bỏ GREATEST(0, …) → client thấy số âm thật.
--   2. process_ingredient_restock: v_before_stock bỏ GREATEST(0, …) → after_stock (mốc neo) = âm + nhập,
--      không còn "quên" nợ (kho -1, nhập 2 → 1 thay vì 2).
-- Chữ ký 2 hàm KHÔNG đổi → không cần REVOKE/GRANT mới; vẫn khai lại SET search_path = public và giữ
-- nguyên ownership guard trong body (copy từ 20261013 / 20260714).

BEGIN;

CREATE OR REPLACE FUNCTION get_ingredient_stocks_v2(p_address_id UUID)
RETURNS TABLE (
    ingredient TEXT,
    current_stock NUMERIC,
    restocked_qty NUMERIC,
    warehouse_stock NUMERIC,
    counter_stock NUMERIC,
    warehouse_stock_set BOOLEAN,
    counter_stock_set BOOLEAN,
    counter_counted_on DATE,
    restock_since_count NUMERIC,
    prior_counter_stock NUMERIC,
    prior_counted_on DATE,
    prior_restock_since NUMERIC,
    counter_counted_at TIMESTAMPTZ,
    prior_counted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_latest_report JSONB;
    v_group_ids     UUID[];
    v_today         DATE;
BEGIN
    -- Ownership guard — xem đầu file. Skip khi auth.uid() IS NULL (service_role/migration).
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

    v_group_ids := public.get_warehouse_group_address_ids(p_address_id);
    v_today := vn_business_date(now());

    SELECT inventory_report INTO v_latest_report
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    WITH
    -- LƯỢT BUNG JSONB DUY NHẤT. Trải trên cả nhóm kho (rút ra quầy ở địa chỉ nào cũng trừ vào
    -- cùng pool); 2 CTE counter_* bên dưới lọc lại về riêng p_address_id.
    closings_flat AS (
        SELECT
            sc.address_id,
            sc.created_at,
            vn_business_date(COALESCE(sc.closed_at, sc.created_at)) AS vn_day,
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock,
            elem->>'remaining'  AS remaining_txt,
            elem->>'opening'    AS opening_txt,
            elem->>'counted_at' AS counted_at_txt
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = ANY(v_group_ids)
          AND sc.inventory_report IS NOT NULL
    ),
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL — QUẦY, không pool, chỉ p_address_id.
    counter_remaining_cte AS (
        SELECT DISTINCT ON (c.ing)
            c.ing,
            c.remaining_txt::NUMERIC AS counter,
            c.vn_day AS counted_on,
            c.counted_at_txt::TIMESTAMPTZ AS counted_at
        FROM closings_flat c
        WHERE c.address_id = p_address_id
          AND c.ing IS NOT NULL
          AND c.remaining_txt IS NOT NULL
        ORDER BY c.ing, c.created_at DESC
    ),
    -- Fallback khi NVL CHƯA từng có remaining (chưa qua lần chốt ca nào) — opening khác-null
    -- gần nhất. Cho phép "Tồn quầy" nhập lúc setup ban đầu hiện ra ngay, trước chốt ca đầu tiên.
    counter_opening_cte AS (
        SELECT DISTINCT ON (c.ing)
            c.ing,
            c.opening_txt::NUMERIC AS counter
        FROM closings_flat c
        WHERE c.address_id = p_address_id
          AND c.ing IS NOT NULL
          AND c.opening_txt IS NOT NULL
        ORDER BY c.ing, c.created_at DESC
    ),
    counter_cte AS (
        SELECT
            COALESCE(r.ing, o.ing) AS ing,
            COALESCE(r.counter, o.counter) AS counter,
            r.counted_on,              -- NULL = counter chỉ từ opening (setup)
            r.counted_at               -- NULL = entry cũ chưa có dấu giờ
        FROM counter_remaining_cte r
        FULL OUTER JOIN counter_opening_cte o ON o.ing = r.ing
    ),
    -- Σ restock của địa chỉ này SAU ngày đếm cuối (ngày đếm đã gồm restock cùng ngày trong số cuối ngày).
    restock_after_count_cte AS (
        SELECT cc.ing, SUM(c.restock) AS total
        FROM counter_cte cc
        JOIN closings_flat c ON c.ing = cc.ing
        WHERE c.address_id = p_address_id
          AND cc.counted_on IS NOT NULL
          AND c.vn_day > cc.counted_on
        GROUP BY cc.ing
    ),
    -- Lần đếm gần nhất TRƯỚC HÔM NAY (cùng quy tắc carry-forward, chỉ p_address_id) + Σ restock giữa lần đó và hôm nay.
    prior_remaining_cte AS (
        SELECT DISTINCT ON (c.ing)
            c.ing,
            c.remaining_txt::NUMERIC AS prior_counter,
            c.vn_day AS prior_on,
            c.counted_at_txt::TIMESTAMPTZ AS prior_at
        FROM closings_flat c
        WHERE c.address_id = p_address_id
          AND c.ing IS NOT NULL
          AND c.remaining_txt IS NOT NULL
          AND c.vn_day < v_today
        ORDER BY c.ing, c.created_at DESC
    ),
    prior_restock_cte AS (
        SELECT pr.ing, SUM(c.restock) AS total
        FROM prior_remaining_cte pr
        JOIN closings_flat c ON c.ing = pr.ing
        WHERE c.address_id = p_address_id
          AND c.vn_day > pr.prior_on
          AND c.vn_day < v_today
        GROUP BY pr.ing
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
            COALESCE(
                an.anchor_stock - COALESCE(rsa.total, 0),
                COALESCE(r.total_refill, 0) - COALESCE(rs.total_restock, 0)
            ) AS wh
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
        COALESCE(c.counter, 0)::NUMERIC AS counter_stock,
        (rf.ing IS NOT NULL) AS warehouse_stock_set,
        (c.counter IS NOT NULL) AS counter_stock_set,
        c.counted_on AS counter_counted_on,
        COALESCE(ra.total, 0)::NUMERIC AS restock_since_count,
        pc.prior_counter::NUMERIC AS prior_counter_stock,
        pc.prior_on AS prior_counted_on,
        COALESCE(pr2.total, 0)::NUMERIC AS prior_restock_since,
        c.counted_at AS counter_counted_at,
        pc.prior_at AS prior_counted_at
    FROM all_keys k
    LEFT JOIN warehouse_cte w  ON w.ing  = k.ing
    LEFT JOIN counter_cte   c  ON c.ing  = k.ing
    LEFT JOIN today_cte     t  ON t.ing  = k.ing
    LEFT JOIN refill_cte    rf ON rf.ing = k.ing
    LEFT JOIN restock_after_count_cte ra ON ra.ing = k.ing
    LEFT JOIN prior_remaining_cte pc ON pc.ing = k.ing
    LEFT JOIN prior_restock_cte pr2 ON pr2.ing = k.ing;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) TO authenticated;

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
    SELECT ROUND(
        COALESCE(
            -- nhánh neo (chỉ khác NULL khi có phiếu lưu after_stock)
            (SELECT anchor_stock FROM anchor)
                - COALESCE((SELECT SUM(qty) FROM restocks
                            WHERE created_at > (SELECT anchor_at FROM anchor)), 0),
            -- fallback công thức cũ
            COALESCE((SELECT SUM(qty) FROM refills), 0)
                - COALESCE((SELECT SUM(qty) FROM restocks
                            WHERE created_at >= (SELECT first_at FROM first_refill)), 0)
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

COMMIT;
