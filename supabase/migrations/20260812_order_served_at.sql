-- ==============================================================================================
-- 20260812_order_served_at.sql
-- Description: mốc "đợt này đã bưng ra cho khách chưa".
--
-- Bàn ngồi lại (20260808_dine_in_open_tables) gom nhiều đợt gọi món vào một bàn. Trước
-- migration này DB chỉ biết hai trạng thái: đã gọi (order tồn tại) và đã tính tiền
-- (table_closed_at) — không có gì ở GIỮA. Quán 2 người trở lên, người pha và người thu
-- tiền không phải một, thì "đợt 17g31 ra món chưa?" phải hỏi miệng.
--
--   orders.served_at — NULL = chưa ra món. Bấm lại lần nữa để bỏ đánh dấu (bấm nhầm).
--
-- CỐ Ý để ở mức ĐỢT, không phải từng món: đợt là cái được pha và bưng ra cùng lúc.
-- Tách tới từng ly thì mỗi lần ra món là mấy cú chạm, nhân viên sẽ bỏ không dùng.
--
-- Đơn CŨ (trước migration) để NULL, không backfill: nói dối "đã ra món" thì không sao,
-- nhưng nói dối "chưa ra món" cho một đợt đã bưng từ hôm qua sẽ làm nhân viên pha lại
-- lần hai. Bàn đang mở lúc chạy migration hiện "chưa ra món" một lần rồi thôi.
--
-- KHÔNG đụng function nào → không có rủi ro rơi search_path (xem CLAUDE.md). Cập nhật
-- đi qua UPDATE thường của client (markOrderServed), dùng lại policy sẵn có trên orders.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS served_at TIMESTAMPTZ;

COMMIT;
