-- ==============================================================================================
-- Giờ đếm của tồn quầy: entry inventory_report có `counted_at` (timestamptz, do SERVER đóng) để tồn quầy lý thuyết trừ
-- đúng các đơn bán SAU lúc đếm — kể cả ngay trong ngày đếm. Trước đây chỉ có NGÀY đếm → đếm 20 ly lúc 10h, bán 1 ly lúc
-- 11h vẫn hiện 20, và phần bán sau giờ đếm của ngày đó rơi mất vĩnh viễn (tiêu hao chỉ cộng từ ngày SAU ngày đếm).
-- 1) merge_shift_closing_inventory: `remaining` đổi (kể cả null → có số) ⇒ counted_at = now(); không đổi ⇒ giữ dấu cũ
--    (sửa Nhập thêm/Đầu kỳ không phải một lần đếm). counted_at máy khách gửi lên bị bỏ. Phần còn lại giữ nguyên 100%
--    so với 20260718_merge_shift_closing_skipped_field.sql.
-- 2) get_ingredient_stocks_v2: +counter_counted_at, +prior_counted_at (NULL ở entry cũ chưa có dấu ⇒ client giữ cách tính
--    theo ngày như trước). Mọi cột và công thức cũ giữ nguyên 100% so với 20261007.
-- Cả hai hàm: khai lại search_path, ownership guard, REVOKE/GRANT. Apply TRƯỚC khi deploy client mới (client mới chịu được
-- thiếu cột — chỉ là chưa trừ đơn sau giờ đếm).
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.merge_shift_closing_inventory(
    p_address_id uuid,
    p_patches    jsonb,                  -- [{ingredient, unit, opening, opening_locked, remaining, restock, skipped}]
    p_closed_by  uuid   DEFAULT NULL,
    p_system_total_revenue bigint DEFAULT 0
)
RETURNS shift_closings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_row      shift_closings;
    v_exists   boolean;
    v_report   jsonb;
    v_patch    jsonb;
    v_ing      text;
    v_tombstone boolean;
    v_old_restock numeric;
    v_delta    numeric;
    v_deltas   jsonb;   -- {ingredient: Σdelta restock} của lần merge này
    v_old_remaining  numeric;
    v_old_counted_at text;
BEGIN
    LOOP
        SELECT * INTO v_row
          FROM shift_closings
         WHERE address_id IS NOT DISTINCT FROM p_address_id
           AND vn_business_date(closed_at) = vn_business_date(now())
         ORDER BY closed_at DESC
         LIMIT 1
         FOR UPDATE;
        v_exists := FOUND;

        v_report := COALESCE(v_row.inventory_report, '[]'::jsonb);
        v_deltas := '{}'::jsonb;

        FOR v_patch IN SELECT jsonb_array_elements(COALESCE(p_patches, '[]'::jsonb)) LOOP
            v_ing := v_patch->>'ingredient';
            -- delta rút = mới − cũ (đọc TRƯỚC khi gỡ entry cũ)
            SELECT (e->>'restock')::numeric, (e->>'remaining')::numeric, e->>'counted_at'
              INTO v_old_restock, v_old_remaining, v_old_counted_at
              FROM jsonb_array_elements(v_report) e
             WHERE e->>'ingredient' = v_ing
             LIMIT 1;
            v_delta := COALESCE((v_patch->>'restock')::numeric, 0) - COALESCE(v_old_restock, 0);
            -- Giờ đếm: số đếm đổi ⇒ bây giờ; không đổi ⇒ giữ dấu cũ (có thể chưa có). Không tin counted_at từ máy khách.
            v_patch := v_patch - 'counted_at';
            IF (v_patch->>'remaining') IS NOT NULL THEN
                IF (v_patch->>'remaining')::numeric IS DISTINCT FROM v_old_remaining THEN
                    v_patch := v_patch || jsonb_build_object('counted_at', now());
                ELSIF v_old_counted_at IS NOT NULL THEN
                    v_patch := v_patch || jsonb_build_object('counted_at', v_old_counted_at);
                END IF;
            END IF;
            IF v_delta <> 0 THEN
                v_deltas := v_deltas
                    || jsonb_build_object(v_ing, COALESCE((v_deltas->>v_ing)::numeric, 0) + v_delta);
            END IF;
            -- gỡ entry cũ của NVL này (nếu có)
            SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_report
              FROM jsonb_array_elements(v_report) e
             WHERE e->>'ingredient' IS DISTINCT FROM v_ing;
            v_tombstone := (v_patch->>'opening')   IS NULL
                       AND (v_patch->>'remaining') IS NULL
                       AND (v_patch->>'restock')   IS NULL
                       AND COALESCE((v_patch->>'skipped')::boolean, false) = false;
            IF NOT v_tombstone THEN
                v_report := v_report || jsonb_build_array(v_patch);
            END IF;
        END LOOP;

        IF v_exists THEN
            UPDATE shift_closings
               SET inventory_report = v_report
             WHERE id = v_row.id
            RETURNING * INTO v_row;

            -- Cascade: refill tạo SAU phiếu chốt ca phải trừ thêm delta rút vào snapshot,
            -- vì lượt rút "xảy ra trước" chúng trên timeline (so theo sc.created_at —
            -- cùng mốc mà anchor CTE của process/get_ingredient_stocks_v2 dùng).
            FOR v_ing IN SELECT jsonb_object_keys(v_deltas) LOOP
                v_delta := (v_deltas->>v_ing)::numeric;
                UPDATE expenses SET metadata = jsonb_set(
                    jsonb_set(
                        metadata,
                        '{before_stock}',
                        to_jsonb(ROUND(COALESCE((metadata->>'before_stock')::numeric, 0) - v_delta, 1))
                    ),
                    '{after_stock}',
                    to_jsonb(ROUND(COALESCE((metadata->>'after_stock')::numeric, 0) - v_delta, 1))
                )
                WHERE address_id IS NOT DISTINCT FROM p_address_id
                  AND is_refill = true
                  AND metadata->>'ingredient' = v_ing
                  AND metadata->>'after_stock' IS NOT NULL
                  AND COALESCE((metadata->>'cancelled')::boolean, false) = false
                  AND created_at > v_row.created_at;
            END LOOP;

            RETURN v_row;
        END IF;

        -- Chưa có phiếu hôm nay → tạo mới. created_at = now() ⇒ không refill nào tạo
        -- sau nó tại thời điểm này → không cần cascade.
        BEGIN
            INSERT INTO shift_closings (address_id, closed_by, inventory_report, system_total_revenue)
            VALUES (p_address_id, p_closed_by, v_report, COALESCE(p_system_total_revenue, 0))
            RETURNING * INTO v_row;
            RETURN v_row;
        EXCEPTION WHEN unique_violation THEN
            -- máy khác vừa tạo phiếu hôm nay → quay lại lock & merge
        END;
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_shift_closing_inventory(uuid, jsonb, uuid, bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.merge_shift_closing_inventory(uuid, jsonb, uuid, bigint) TO authenticated;

DROP FUNCTION IF EXISTS get_ingredient_stocks_v2(UUID);

CREATE FUNCTION get_ingredient_stocks_v2(p_address_id UUID)
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

COMMIT;
