-- ============================================================
-- Kiểm kê hao hụt đa thiết bị — đồng bộ qua DB (nguồn sự thật)
--
-- VẤN ĐỀ: 2 người (quản lý + nhân viên) cùng nhập kiểm kê trên 2 điện thoại.
-- Cơ chế cũ chỉ broadcast keystroke (ephemeral, không replay, rớt gói là mất) nên
-- 2 máy không hội tụ. Chuyển sang: mỗi máy autosave field đã đổi vào shift_closings,
-- máy kia nghe postgres_changes rồi merge.
--
-- 2 phần:
--   1. Bật Realtime cho shift_closings (publication + REPLICA IDENTITY FULL) để
--      payload.new mang đủ inventory_report cho client merge.
--   2. RPC merge_shift_closing_inventory — merge JSON theo từng nguyên liệu DƯỚI ROW
--      LOCK ⇒ race-free tuyệt đối: 2 người sửa 2 NVL khác nhau không đè nhau; cùng 1
--      NVL thì last-write-wins (không tránh được). Tombstone (mọi số = null) = xoá NVL.
--
-- AN TOÀN KHO: warehouse_stock được get_ingredient_stocks_v2 TÍNH lúc đọc = Σrefill −
-- Σrestock ngay từ JSON này (KHÔNG phải cột bị trigger trừ dần). Nên merge JSON đúng
-- ⇒ kho tự đúng. Trigger trg_subtract_stock chỉ AFTER INSERT (bảng inventory legacy) —
-- RPC vẫn INSERT khi chưa có phiếu nên giữ nguyên hành vi đó.
--
-- Theo CLAUDE.md: hàm mới → SET search_path = public; SECURITY INVOKER để RLS
-- managers_shift_closings tự chặn theo address; REVOKE PUBLIC/anon + GRANT authenticated.
-- ============================================================

-- ── 1. Bật Realtime ─────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'shift_closings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.shift_closings;
    END IF;
END $$;

-- payload.new đủ cột (cần inventory_report) + filter address_id hoạt động trên UPDATE.
ALTER TABLE public.shift_closings REPLICA IDENTITY FULL;

-- ── 2. RPC merge theo từng nguyên liệu, dưới row lock ───────────────────────
CREATE OR REPLACE FUNCTION public.merge_shift_closing_inventory(
    p_address_id uuid,
    p_patches    jsonb,                  -- [{ingredient, unit, opening, opening_locked, remaining, restock}]
    p_closed_by  uuid   DEFAULT NULL,
    p_system_total_revenue bigint DEFAULT 0  -- chỉ dùng khi INSERT phiếu mới (snapshot doanh thu hệ thống)
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
BEGIN
    -- Lặp để xử lý đua INSERT: nếu chưa có phiếu hôm nay mà 2 máy cùng tạo, máy thua
    -- bắt unique_violation rồi quay lại lock+merge phiếu của máy thắng.
    LOOP
        SELECT * INTO v_row
          FROM shift_closings
         WHERE address_id = p_address_id
           AND vn_business_date(closed_at) = vn_business_date(now())
         ORDER BY closed_at DESC
         LIMIT 1
         FOR UPDATE;
        -- Chốt sự-tồn-tại NGAY: các SELECT/FOR bên dưới sẽ ghi đè FOUND.
        v_exists := FOUND;

        v_report := COALESCE(v_row.inventory_report, '[]'::jsonb);

        FOR v_patch IN SELECT jsonb_array_elements(COALESCE(p_patches, '[]'::jsonb)) LOOP
            v_ing := v_patch->>'ingredient';
            -- gỡ entry cũ của NVL này (nếu có)
            SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) INTO v_report
              FROM jsonb_array_elements(v_report) e
             WHERE e->>'ingredient' IS DISTINCT FROM v_ing;
            -- tombstone = mọi số null ⇒ xoá; ngược lại upsert lại entry
            v_tombstone := (v_patch->>'opening')   IS NULL
                       AND (v_patch->>'remaining') IS NULL
                       AND (v_patch->>'restock')   IS NULL;
            IF NOT v_tombstone THEN
                v_report := v_report || jsonb_build_array(v_patch);
            END IF;
        END LOOP;

        IF v_exists THEN
            UPDATE shift_closings
               SET inventory_report = v_report
             WHERE id = v_row.id
            RETURNING * INTO v_row;
            RETURN v_row;
        END IF;

        -- Chưa có phiếu hôm nay → tạo mới (fires trg_subtract_stock như đường INSERT cũ).
        -- cash/transfer mặc định 0 (do "Lưu thực thu" làm chủ); revenue snapshot từ param.
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
