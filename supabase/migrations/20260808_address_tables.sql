-- ==============================================================================================
-- 20260808_address_tables.sql
-- Description: danh sách bàn cố định của địa chỉ.
--
-- 20260808_dine_in_open_tables cho mở bàn bằng cách gõ tên — đủ cho quán 2-3 bàn, nhưng
-- quán 10 bàn cố định thì gõ lại mỗi ngày là vô lý, và bàn trống không nhìn thấy được
-- (chỉ bàn có khách mới hiện). Lưu sẵn danh sách một lần, màn /tables vẽ đủ 10 ô, ô nào
-- có khách thì có tiền.
--
--   addresses.tables — mảng tên bàn, giữ nguyên thứ tự người dùng nhập. '{}' = chưa
--                      tạo sẵn bàn nào (giữ đúng hành vi cũ: gõ tên là mở bàn tạm).
--
-- Thêm cột vào addresses an toàn: không có function/policy nào phụ thuộc hình dạng dòng
-- (không có SETOF addresses, không có SELECT a.*), createAddress chỉ insert manager_id+name
-- nên bản clone không tha theo danh sách bàn của quán nguồn.
--
-- Không đụng function nào → không có rủi ro rơi search_path (xem CLAUDE.md).
-- Ghi/xoá đi qua UPDATE thường của client, cùng RLS mà dine_in đang dùng.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

ALTER TABLE addresses ADD COLUMN IF NOT EXISTS tables TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
