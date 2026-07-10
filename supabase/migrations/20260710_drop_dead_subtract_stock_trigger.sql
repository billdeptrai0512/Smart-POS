-- ==============================================================================================
-- 20260710_drop_dead_subtract_stock_trigger.sql — dọn code chết còn sót trong lịch sử migration
--
-- Bối cảnh: 20260508_drop_legacy_inventory.sql đã DROP bảng `inventory` + function
-- subtract_stock_from_restock() + trigger trg_subtract_stock với lý do "no client code reads
-- from it" (kho hiện đọc qua shift_closings + expenses, không qua bảng inventory legacy).
--
-- Nhưng 20260511/20260512/20260513 (SAU 20260508) lại CREATE OR REPLACE tái tạo cả function
-- lẫn trigger, body vẫn UPDATE bảng `inventory` — bảng không còn tồn tại ở bất kỳ migration
-- nào sau 20260508. Đã xác nhận trực tiếp trên production (2026-07-10): cả bảng `inventory`
-- lẫn trigger `trg_subtract_stock` lẫn chính function đều KHÔNG tồn tại. Trên production hiện
-- tại migration này là NO-OP (không có gì để xoá) — mục đích là khoá lại đúng ý định "dead code"
-- của 20260508 trong lịch sử migration, phòng trường hợp DB được dựng lại bằng cách replay toàn
-- bộ migration từ đầu (không phải quy trình staging hiện tại của team, nhưng vẫn nên đúng).
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_subtract_stock ON public.shift_closings;
DROP FUNCTION IF EXISTS public.subtract_stock_from_restock() CASCADE;

COMMIT;
