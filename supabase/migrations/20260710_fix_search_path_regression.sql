-- ==============================================================================================
-- 20260710_fix_search_path_regression.sql — đợt 5 dọn Security Advisor (sau 20260505/20260520/20260603/20260612)
--
-- Phát hiện bởi scripts/check-search-path.mjs (script mới, quét toàn bộ migrations theo thứ tự
-- thời gian, giữ định nghĩa hiệu lực cuối cùng của mỗi function). 6 function sau đang thiếu
-- SET search_path trong định nghĩa hiệu lực cuối cùng — cùng nguyên nhân quen thuộc (CREATE OR
-- REPLACE FUNCTION làm rơi search_path khi recreate mà không khai báo lại):
--
-- 1. get_today_stats(uuid)        — recreate ở 20260504_fix_rpc_exclude_deleted, mất search_path.
-- 2. user_owner_id(uuid)          — tạo ở 20260501_rls_denorm_step1_setup, chưa từng có search_path.
-- 3. trg_seed_expense_categories()               — trigger, 20260525_expense_categories.
-- 4. trg_touch_expense_categories_updated_at()   — trigger, 20260525_expense_categories.
-- 5. ensure_ingredients_stock()      — one-shot bootstrap (đã chạy 1 lần ở 20260510, không còn
--    được gọi lại ở đâu khác). Vá cho sạch advisor, không đổi behavior (không ai gọi lại).
-- 6. subtract_stock_from_restock()   — CODE CHẾT ĐÃ XÁC NHẬN (2026-07-10): 20260508 đã DROP bảng
--    `inventory` + function + trigger này. 20260511/20260512/20260513 (SAU đó) CREATE OR REPLACE
--    lại function + trigger trg_subtract_stock trên shift_closings, body vẫn UPDATE bảng
--    `inventory` — nhưng đã kiểm tra trực tiếp trên production:
--      SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='inventory'; → 0 dòng
--      SELECT tgname FROM pg_trigger WHERE tgname='trg_subtract_stock';                     → 0 dòng
--    Xác nhận: cả bảng lẫn trigger đều KHÔNG tồn tại trên production (3 migration 0511-0513 chưa
--    từng được áp dụng thật, hoặc bị gỡ ngoài migration track). Function `subtract_stock_from_restock`
--    tự thân CÓ THỂ vẫn tồn tại (orphan, không trigger nào gọi) hoặc cũng không — chưa xác nhận.
--
-- ⚠️ SỬA SO VỚI BẢN NHÁP TRƯỚC: `ALTER FUNCTION` KHÔNG có cú pháp `IF EXISTS` trong Postgres —
-- nếu function không tồn tại, câu lệnh sẽ lỗi và ROLLBACK TOÀN BỘ migration (kể cả 5 hàm còn lại
-- đang cần vá thật). Vì subtract_stock_from_restock (và ensure_ingredients_stock, chưa xác nhận
-- chắc chắn) có rủi ro không tồn tại, MỌI câu ALTER FUNCTION dưới đây được bọc trong DO block +
-- to_regprocedure() để tự bỏ qua nếu function không có — an toàn tuyệt đối, không phụ thuộc giả định.
--
-- Dọn dẹp thật (DROP function/trigger chết, nếu function vẫn còn tồn tại dạng orphan) là một
-- migration RIÊNG sau khi xác nhận thêm — không nằm trong migration này.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

DO $$
BEGIN
    IF to_regprocedure('public.get_today_stats(uuid)') IS NOT NULL THEN
        ALTER FUNCTION public.get_today_stats(uuid) SET search_path = public;
    END IF;

    IF to_regprocedure('public.user_owner_id(uuid)') IS NOT NULL THEN
        ALTER FUNCTION public.user_owner_id(uuid) SET search_path = public;
    END IF;

    IF to_regprocedure('public.trg_seed_expense_categories()') IS NOT NULL THEN
        ALTER FUNCTION public.trg_seed_expense_categories() SET search_path = public;
    END IF;

    IF to_regprocedure('public.trg_touch_expense_categories_updated_at()') IS NOT NULL THEN
        ALTER FUNCTION public.trg_touch_expense_categories_updated_at() SET search_path = public;
    END IF;

    IF to_regprocedure('public.ensure_ingredients_stock()') IS NOT NULL THEN
        ALTER FUNCTION public.ensure_ingredients_stock() SET search_path = public;
    END IF;

    IF to_regprocedure('public.subtract_stock_from_restock()') IS NOT NULL THEN
        ALTER FUNCTION public.subtract_stock_from_restock() SET search_path = public;
    END IF;
END $$;

COMMIT;
