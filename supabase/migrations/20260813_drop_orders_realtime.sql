-- ============================================================
-- Đồng bộ đơn đa thiết bị — tắt Supabase Realtime cho orders.
--
-- Kênh `orders-realtime-${addressId}` (POSContext) đã bị gỡ, thay bằng poll 5s có diff
-- (src/hooks/useOrdersPoll.js). Hai lý do, ghi lại ở docs/MONETIZATION.md §7.1:
--   1. Cổng mở kênh đếm active_sessions >= 2, mà bảng đó khoá theo user_id — hai máy
--      đăng nhập cùng tài khoản đếm ra 1, kênh không bao giờ mở. Đồng bộ chưa từng chạy
--      cho ca dùng phổ biến nhất (quán nhỏ, một tài khoản, hai máy).
--   2. Trần ~500 kết nối đồng thời không cõng nổi 1000 quán × 2 máy; poll stateless thì có.
--
-- Không còn client nào subscribe → để orders trong publication chỉ tốn công decode WAL
-- cho đúng cái bảng ghi nhiều nhất hệ thống.
--
-- KHÔNG đụng shift_closings: useShiftInventoryState.js vẫn dùng kênh realtime của nó.
-- Không đụng function nào → không dính rủi ro search_path/GRANT của CLAUDE.md.
--
-- IDEMPOTENT: chỉ DROP nếu đang có. Publication này bật tay trên dashboard (repo không
-- có migration nào ADD orders vào), nên trên môi trường chưa bật thì đây là no-op.
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;
    END IF;
END $$;
