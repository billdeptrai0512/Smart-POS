-- ==============================================================================================
-- Gỡ index trùng trên shift_closings — do chính đợt 20260912_ingredient_stocks_one_pass gây ra.
--
-- Advisor báo: {idx_shift_closings_addr_created, idx_shift_closings_address_created} là hai
-- index GIỐNG HỆT nhau.
--
-- Vì sao lọt: lúc viết 20260912_ingredient_stocks_one_pass.sql tôi grep các file migration để
-- xem shift_closings đã có index nào, thấy duy nhất idx_shift_closings_address_closed (đánh
-- theo closed_at) nên kết luận "thiếu index (address_id, created_at)" và tạo mới. Nhưng
-- idx_shift_closings_addr_created KHÔNG nằm trong file migration nào — nó được tạo thẳng trên
-- prod ngoài luồng (SQL editor / theo gợi ý của Index Advisor). Tức là: file migration KHÔNG
-- phản ánh đúng schema đang chạy, và câu "index còn thiếu" trong comment của migration đó là SAI.
--
-- Giữ cái nào: giữ idx_shift_closings_address_created (có trong migration) và bỏ
-- idx_shift_closings_addr_created (không có trong migration). Làm ngược lại thì một môi trường
-- dựng lại từ migration sẽ âm thầm thiếu index này.
--
-- CHẠY TRƯỚC ĐỂ ĐỐI CHIẾU — phải thấy 2 dòng indexdef y hệt nhau (chỉ khác tên):
--
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'shift_closings'
--   order by indexname;
--
-- Nếu 2 định nghĩa KHÁC nhau (cột khác, thứ tự khác, có WHERE) thì DỪNG, đừng chạy file này.
-- ==============================================================================================

BEGIN;

DROP INDEX IF EXISTS public.idx_shift_closings_addr_created;

COMMIT;
