-- =============================================
-- merge_shift_closing_inventory: support a `skipped` field per ingredient patch
-- =============================================
-- "Soạn cho hôm nay" đã có nút bỏ qua (✕) từng nguyên liệu ("đã xem, không cần lấy"), nhưng
-- trạng thái đó trước giờ chỉ lưu localStorage (không đồng bộ đa thiết bị, khác máy thấy
-- trạng thái khác nhau). Giờ đẩy `skipped` vào cùng patch object với opening/remaining/restock
-- để nó đi qua đúng cơ chế merge race-free + Realtime đã có sẵn cho restock.
--
-- Thay đổi duy nhất so với 20260716_merge_shift_closing_null_address.sql: điều kiện tombstone
-- (entry bị xoá khỏi inventory_report khi patch toàn null) giờ PHẢI giữ lại entry nếu
-- `skipped = true`, nếu không lượt bỏ-qua-mà-không-nhập-số-nào sẽ bị coi là tombstone và rơi
-- mất ngay khi merge. Mọi phần khác giữ nguyên.
--
-- Per CLAUDE.md: SET search_path = public kept; SECURITY INVOKER kept; re-apply
-- REVOKE/GRANT since CREATE OR REPLACE drops them (signature không đổi).

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
            SELECT (e->>'restock')::numeric INTO v_old_restock
              FROM jsonb_array_elements(v_report) e
             WHERE e->>'ingredient' = v_ing
             LIMIT 1;
            v_delta := COALESCE((v_patch->>'restock')::numeric, 0) - COALESCE(v_old_restock, 0);
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
