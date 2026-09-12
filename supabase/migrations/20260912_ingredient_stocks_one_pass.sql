-- ==============================================================================================
-- get_ingredient_stocks_v2 — gộp 3 lượt bung jsonb inventory_report thành 1, + index còn thiếu.
--
-- VÌ SAO KHÔNG cắt theo mốc ngày: counter_remaining_cte/counter_opening_cte là carry-forward —
-- lấy `remaining`/`opening` KHÁC-NULL GẦN NHẤT của từng nguyên liệu. Nguyên liệu cả tháng không
-- ai đếm thì lần đếm cuối nằm ngoài mọi cửa sổ ngày hợp lý; thêm WHERE created_at >= X là tồn
-- quầy của nó tụt về 0. Chi phí thật nằm ở chỗ ĐỌC LẠI cùng một đống JSONB nhiều lần, không ở
-- phạm vi ngày — nên sửa đúng chỗ đó:
--
--   Trước: 3 lần CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report)
--          (counter_remaining_cte, counter_opening_cte, closings_flat).
--   Sau:   1 lần — closings_flat mang thêm address_id + remaining/opening dạng TEXT, hai CTE
--          counter_* đọc lại từ nó. CTE được tham chiếu nhiều lần nên Postgres materialize,
--          tức bung đúng một lượt.
--
-- Giữ remaining/opening ở dạng TEXT trong closings_flat rồi mới ::NUMERIC trong 2 CTE counter_*
-- (KHÔNG cast sẵn ở closings_flat): closings_flat trải rộng trên CẢ NHÓM kho, còn 2 CTE kia chỉ
-- đọc p_address_id. Cast sẵn sẽ ép cast luôn dữ liệu của địa chỉ khác trong nhóm — một giá trị
-- rác ở đó sẽ làm cả hàm lỗi, chuyện bản cũ không hề có.
--
-- v_group_ids LUÔN chứa p_address_id (get_warehouse_group_address_ids fallback ARRAY[p_address_id],
-- nhánh nhóm join a2 trên cùng warehouse_group_id nên có cả a1) → lọc lại address_id = p_address_id
-- từ closings_flat cho đúng tập hàng như 2 CTE cũ.
--
-- Mọi công thức tính (counter/today/refill/restock/anchor/warehouse) giữ nguyên 100%.
--
-- THÊM ownership guard (trước giờ hàm này KHÔNG có). Nó là SECURITY DEFINER, tức bỏ qua RLS,
-- mà lại nhận p_address_id tuỳ ý: bất kỳ tài khoản `authenticated` nào cũng gọi được
-- /rest/v1/rpc/get_ingredient_stocks_v2 với address_id của quán khác và đọc sạch tồn kho +
-- danh mục nguyên liệu của họ. Cùng họ với đợt sync_group_unit_cost (20260814). Guard copy
-- nguyên pattern của 20260517_fix_restock_current_stock.sql (admin OR manager trực tiếp OR
-- co-manager qua user_address_access), và BỎ QUA khi auth.uid() IS NULL để service_role /
-- migration / script staging vẫn gọi được như cũ.
--
-- Không chặn nhầm đường nào đang chạy: client chỉ gọi hàm này với selectedAddress.id hoặc id
-- của địa chỉ anh em cùng nhóm kho, mà siblingsByAddress lại suy ra TỪ `addresses` user đọc
-- được qua RLS (AddressContext) — nên mọi id truyền vào đều là địa chỉ user có quyền. Đường
-- "Mẫu mặc định" (address_id = null) đi hàm khác: get_default_ingredient_stocks.
--
-- Theo CLAUDE.md: khai lại `SET search_path = public` trong body (CREATE OR REPLACE làm rơi mọi
-- ALTER FUNCTION SET search_path vá trước đó). Signature không đổi nên ACL cũ còn nguyên;
-- REVOKE/GRANT dưới đây chỉ là khẳng định lại cho chắc (đã 5 đợt advisor vì đúng chỗ này).
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_ingredient_stocks_v2(p_address_id UUID)
RETURNS TABLE (
    ingredient TEXT,
    current_stock NUMERIC,
    restocked_qty NUMERIC,
    warehouse_stock NUMERIC,
    counter_stock NUMERIC,
    warehouse_stock_set BOOLEAN,
    counter_stock_set BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_latest_report JSONB;
    v_group_ids     UUID[];
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
            elem->>'ingredient' AS ing,
            COALESCE((elem->>'restock')::NUMERIC, 0) AS restock,
            elem->>'remaining'  AS remaining_txt,
            elem->>'opening'    AS opening_txt
        FROM shift_closings sc
        CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = ANY(v_group_ids)
          AND sc.inventory_report IS NOT NULL
    ),
    -- CARRY-FORWARD: remaining khác-null gần nhất của từng NVL — QUẦY, không pool, chỉ p_address_id.
    counter_remaining_cte AS (
        SELECT DISTINCT ON (c.ing)
            c.ing,
            c.remaining_txt::NUMERIC AS counter
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
            COALESCE(r.counter, o.counter) AS counter
        FROM counter_remaining_cte r
        FULL OUTER JOIN counter_opening_cte o ON o.ing = r.ing
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
        (c.counter IS NOT NULL) AS counter_stock_set
    FROM all_keys k
    LEFT JOIN warehouse_cte w  ON w.ing  = k.ing
    LEFT JOIN counter_cte   c  ON c.ing  = k.ing
    LEFT JOIN today_cte     t  ON t.ing  = k.ing
    LEFT JOIN refill_cte    rf ON rf.ing = k.ing;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ingredient_stocks_v2(uuid) TO authenticated;

-- Index còn thiếu: hàm trên lọc/sắp theo (address_id, created_at) trên shift_closings, nhưng
-- index duy nhất có address_id lại đánh theo closed_at (idx_shift_closings_address_closed) —
-- nên mọi lần gọi phải sort lại toàn bộ phiếu chốt của địa chỉ. Cũng phục vụ luôn SELECT
-- ... ORDER BY created_at DESC LIMIT 1 lấy v_latest_report ở đầu hàm.
CREATE INDEX IF NOT EXISTS idx_shift_closings_address_created
    ON public.shift_closings USING btree (address_id, created_at DESC);

COMMIT;
