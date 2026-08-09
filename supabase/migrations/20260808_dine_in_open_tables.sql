-- ==============================================================================================
-- 20260808_dine_in_open_tables.sql
-- Description: bàn = tab mở, gom nhiều đợt gọi món.
--
-- 20260808_dine_in_mode đã thêm orders.table_name (nhãn dán lên 1 đơn). Quán ngồi lại
-- cần hơn thế: khách gọi đợt 1, ngồi tiếp, gọi đợt 2 — cùng một bàn, tính tiền một lần
-- lúc về. Mỗi đợt vẫn là 1 order riêng (doanh thu/báo cáo/offline-sync không đổi gì),
-- cái thiếu duy nhất là mốc "bàn này đã tính tiền chưa".
--
--   orders.table_closed_at — NULL = bàn còn mở. Đóng bàn = UPDATE cả nhóm cùng lúc.
--
-- Bàn đang mở = các đơn cùng address_id + table_name, chưa xoá, chưa đóng. CỐ Ý KHÔNG
-- giới hạn theo ngày: quán mở qua nửa đêm thì bàn ngồi từ 23g50 sang 0g10 vẫn phải là
-- MỘT bàn, cắt theo ngày là mất nửa hoá đơn của khách.
--
-- KHÔNG đụng function nào → không có rủi ro rơi search_path (xem CLAUDE.md). Đóng bàn
-- đi qua UPDATE thường của client, dùng lại policy managers_full_access sẵn có trên orders.
--
-- IDEMPOTENT — chạy lại an toàn (xem guard của backfill bên dưới).
-- ==============================================================================================

BEGIN;

-- ALTER + backfill nằm chung một nhánh "cột chưa tồn tại". Ở lần chạy đầu, mọi đơn có
-- table_name đều là đơn CŨ từ trước tính năng này (nhãn bàn rời, không có khái niệm
-- bàn mở) → đóng hết, nếu không chúng hiện ra như bàn đang có khách. Chạy lại lần sau
-- cột đã có nên nhánh bị bỏ qua, bàn đang mở thật không bị đóng oan.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'table_closed_at'
  ) THEN
    ALTER TABLE orders ADD COLUMN table_closed_at TIMESTAMPTZ;
    -- EXECUTE: câu lệnh tham chiếu cột vừa tạo trong cùng block, dynamic SQL được
    -- parse lúc chạy nên chắc chắn thấy cột mới.
    EXECUTE 'UPDATE orders SET table_closed_at = created_at WHERE table_name IS NOT NULL';
  END IF;
END $$;

-- Partial index: màn /tables chỉ hỏi đúng tập này, và nó luôn nhỏ (số bàn đang có khách).
CREATE INDEX IF NOT EXISTS idx_orders_open_tables
  ON orders (address_id, table_name)
  WHERE table_name IS NOT NULL AND table_closed_at IS NULL;

COMMIT;
