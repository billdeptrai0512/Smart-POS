-- ==============================================================================================
-- Xác nhận kiểm kê lần cuối: entry NVL trong shift_closings.inventory_report có thêm `confirmed_at`.
-- set_inventory_confirm: mọi entry đã đếm (remaining khác null) ⇒ confirmed_at = counted_at = now(). counted_at là mốc trừ đơn
-- (usageAfterCount / estimateOpening) nên đơn tạo SAU giờ xác nhận trừ vào số vừa xác nhận ("Tồn quầy hiện có" = lý thuyết mới),
-- và Đầu kỳ ngày mới = số xác nhận − đơn sau giờ đó.
-- merge_shift_closing_inventory: số `remaining` đổi (hoặc recounted) ⇒ xác nhận cũ hết hiệu lực (bỏ confirmed_at, cần xác nhận lại);
-- không đổi ⇒ giữ confirmed_at (sửa Nhập thêm không làm mất). Phần còn lại giữ nguyên 100% so với 20261015_restock_at_by.sql.
-- ==============================================================================================

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
    v_old_confirmed_at text;
    v_old_restock_at text;
    v_old_restock_by text;
    v_by_name        text;
    v_recount        boolean;
BEGIN
    SELECT name INTO v_by_name FROM users WHERE id = p_closed_by;
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
            SELECT (e->>'restock')::numeric, (e->>'remaining')::numeric, e->>'counted_at', e->>'confirmed_at', e->>'restock_at', e->>'restock_by_name'
              INTO v_old_restock, v_old_remaining, v_old_counted_at, v_old_confirmed_at, v_old_restock_at, v_old_restock_by
              FROM jsonb_array_elements(v_report) e
             WHERE e->>'ingredient' = v_ing
             LIMIT 1;
            v_delta := COALESCE((v_patch->>'restock')::numeric, 0) - COALESCE(v_old_restock, 0);
            -- Giờ đếm: số đếm đổi hoặc xác nhận đếm lại (recounted) ⇒ bây giờ; không đổi ⇒ giữ dấu cũ (có thể chưa có). Không tin counted_at từ máy khách.
            v_recount := COALESCE((v_patch->>'recounted')::boolean, false);
            v_patch := v_patch - 'counted_at' - 'recounted' - 'restock_at' - 'restock_by_name' - 'confirmed_at';
            IF (v_patch->>'restock') IS NOT NULL THEN
                IF v_delta <> 0 THEN
                    v_patch := v_patch || jsonb_build_object('restock_at', now(), 'restock_by_name', v_by_name);
                ELSIF v_old_restock_at IS NOT NULL THEN
                    v_patch := v_patch || jsonb_build_object('restock_at', v_old_restock_at, 'restock_by_name', v_old_restock_by);
                END IF;
            END IF;
            IF (v_patch->>'remaining') IS NOT NULL THEN
                IF v_recount OR (v_patch->>'remaining')::numeric IS DISTINCT FROM v_old_remaining THEN
                    v_patch := v_patch || jsonb_build_object('counted_at', now());
                ELSE
                    v_patch := v_patch || jsonb_strip_nulls(jsonb_build_object('counted_at', v_old_counted_at, 'confirmed_at', v_old_confirmed_at));
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

-- Xác nhận kiểm kê hôm nay. SECURITY INVOKER như merge: RLS của shift_closings là cổng quyền. Điều kiện "đã đếm hết NVL" do client kiểm.
CREATE OR REPLACE FUNCTION public.set_inventory_confirm(p_address_id uuid)
RETURNS shift_closings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_row shift_closings;
BEGIN
    SELECT * INTO v_row
      FROM shift_closings
     WHERE address_id IS NOT DISTINCT FROM p_address_id
       AND vn_business_date(closed_at) = vn_business_date(now())
     ORDER BY closed_at DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chưa có phiếu kiểm kê hôm nay';
    END IF;

    UPDATE shift_closings
       SET inventory_report = (
            SELECT COALESCE(jsonb_agg(
                CASE WHEN e->>'remaining' IS NOT NULL
                     THEN e || jsonb_build_object('confirmed_at', now(), 'counted_at', now())
                     ELSE e END), '[]'::jsonb)
              FROM jsonb_array_elements(COALESCE(v_row.inventory_report, '[]'::jsonb)) e)
     WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_inventory_confirm(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_inventory_confirm(uuid) TO authenticated;
