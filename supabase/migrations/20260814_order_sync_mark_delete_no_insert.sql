-- ==============================================================================================
-- 20260814_order_sync_mark_delete_no_insert.sql
-- Description: trigger watermark không được TẠO mốc từ một lệnh DELETE — nó chặn xoá địa chỉ.
--
-- VẤN ĐỀ. Nút "Xoá vĩnh viễn" ở /addresses báo:
--   insert or update on table "order_sync_marks" violates foreign key constraint
--   "order_sync_marks_address_id_fkey"
-- Xoá một địa chỉ làm cascade xoá CẢ order_sync_marks LẪN orders. Mỗi dòng orders bị cascade
-- lại gọi bump_order_sync_mark, mà hàm đó INSERT ... ON CONFLICT: mốc vừa bị cascade xoá nên
-- không có gì để conflict, INSERT chạy thật và dựng lại một dòng trỏ tới địa chỉ đang bị xoá.
-- Khoá ngoại chặn ⇒ đổ cả lệnh xoá. Xoá địa chỉ hỏng hoàn toàn kể từ 20260813_orders_sync_marks.
--
-- CÁCH SỬA. Nhánh DELETE chỉ UPDATE, không bao giờ INSERT. Không mất gì:
--   - địa chỉ còn sống: dòng orders bị xoá cứng ⇒ mốc CHẮC CHẮN đã có (chính lệnh INSERT đơn đó
--     đã tạo ra nó) ⇒ UPDATE vẫn bump, đơn ma vẫn biến mất khỏi các máy khác như thiết kế.
--   - địa chỉ đang bị xoá: UPDATE khớp 0 dòng, im lặng đi qua — đúng thứ mình muốn, không ai
--     còn poll một địa chỉ không tồn tại.
--
-- IDEMPOTENT — chạy lại an toàn. Giữ nguyên signature nên quyền cũ còn nguyên, nhưng CREATE OR
-- REPLACE làm rơi search_path nên phải khai lại (xem CLAUDE.md).
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bump_order_sync_mark()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_id UUID := COALESCE(NEW.address_id, OLD.address_id);
BEGIN
    IF v_address_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- KHÔNG upsert: xem phần đầu file. Mốc thiếu ở đây luôn có nghĩa "địa chỉ đi rồi".
        UPDATE order_sync_marks
           SET rev = rev + 1, updated_at = now()
         WHERE address_id = v_address_id;
    ELSE
        INSERT INTO order_sync_marks (address_id, rev, updated_at)
        VALUES (v_address_id, 1, now())
        ON CONFLICT (address_id) DO UPDATE
            SET rev = order_sync_marks.rev + 1, updated_at = now();
    END IF;

    RETURN NULL;   -- AFTER trigger, giá trị trả về bị bỏ qua
END;
$$;

-- Hàm trigger: không ai được gọi tay, kể cả authenticated.
REVOKE EXECUTE ON FUNCTION public.bump_order_sync_mark() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_order_sync_mark() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bump_order_sync_mark() FROM authenticated;

COMMIT;
