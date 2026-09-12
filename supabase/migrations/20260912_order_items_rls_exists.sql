-- ==============================================================================================
-- managers_order_items — đổi `IN (subquery)` thành `EXISTS (correlated)`.
--
-- Policy hiện hành (20260503_fix_disk_io.sql):
--
--     order_id IN (
--         SELECT id FROM orders
--         WHERE is_admin_auth(auth.uid())
--            OR address_id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
--     )
--
-- Subquery đó KHÔNG có mốc thời gian: nó dựng ra id của MỌI đơn user từng tạo, rồi mới lọc.
-- Quán chạy 1 năm ở ~80 đơn/ngày là ~30.000 id phải gom lại — mỗi lần đọc order_items, kể cả
-- khi chỉ cần ~150 dòng của hôm nay. Chi phí tăng tuyến tính theo TUỔI quán, nên trang báo cáo
-- càng dùng lâu càng chậm. Đo trên prod: `orders` (kèm embed order_items) mất ~1.2s, gấp 4 lần
-- get_daily_report_context (265ms) và expenses (379ms) chạy song song cùng lúc — và chính nó
-- là cái giữ skeleton của /daily-report (isReady chờ đủ 3 call).
--
-- EXISTS có tương quan thì Postgres tra thẳng PK orders.id cho từng dòng order_items đang xét:
-- ~150 lần index lookup thay vì gom 30.000 id. Hằng số theo tuổi quán.
--
-- Tương đương về mặt logic: orders.id là PK (duy nhất) nên `x IN (SELECT id FROM orders WHERE P)`
-- và `EXISTS (SELECT 1 FROM orders o WHERE o.id = x AND P(o))` cho cùng kết quả. order_id NULL:
-- IN trả NULL, EXISTS trả false — cả hai đều làm dòng bị loại, không đổi hành vi.
--
-- Bọc CẢ lời gọi is_admin_auth trong (SELECT ...), không phải chỉ đối số auth.uid() bên trong:
-- `is_admin_auth((SELECT auth.uid()))` vẫn là một lời gọi hàm ở mỗi dòng — STABLE không có
-- nghĩa là Postgres nhớ kết quả, nó chỉ hứa cùng-câu-thì-cùng-kết-quả. Phải là
-- `(SELECT is_admin_auth(auth.uid()))` thì mới thành InitPlan chạy đúng một lần cho cả câu.
-- Đây cũng chính là chi phí lớn của bản cũ: is_admin_auth nằm trong WHERE của subquery quét
-- toàn bộ đơn, tức một lời gọi SECURITY DEFINER (kèm tra bảng users) trên MỖI đơn đã quét.
-- Subquery IN user_address_access thì không tương quan nên vốn đã là SubPlan chạy một lần.
--
-- FOR ALL mà không khai WITH CHECK thì Postgres lấy luôn USING làm check cho INSERT/UPDATE —
-- giữ nguyên như bản cũ, và EXISTS chạy đúng với dòng mới (order_id đã có giá trị lúc check).
--
-- KHÔNG đụng policy `managers_full_access` trên orders. Nó dính ĐÚNG bệnh is_admin_auth-mỗi-dòng
-- nói trên, nhưng ở đó chỉ có ~81 đơn của hôm nay nên là ~81 lời gọi, không phải ~30.000 — sửa
-- thì đúng về lý mà không đo được gì, và mỗi policy sửa thêm là một bề mặt phải kiểm lại. Nếu
-- sau này đo thấy đáng thì bọc y hệt: (SELECT public.is_admin_auth(auth.uid())).
--
-- ĐÃ ĐO trên prod (address 16 DBT Q8, 11.695 đơn lịch sử, 55 đơn / 97 order_items hôm nay),
-- bằng EXPLAIN (ANALYZE, BUFFERS) của `select count(*) from orders join order_items` dưới role
-- authenticated:
--
--   TRƯỚC:  Merge Join. `Seq Scan on orders` quét 41.021 dòng (đơn của MỌI quán, không riêng
--           address này) làm hashed SubPlan; nhánh order_items quét 48.862 dòng rồi bỏ 35.186.
--           Buffers 112.480 (~880 MB). Execution Time 571 ms.
--   SAU:    Nested Loop. order_items được dẫn bởi 55 đơn hôm nay (Index Cond: order_id = o.id),
--           RLS thành `Index Scan using orders_pkey`, 97 loops × 0,022 ms. Không còn dòng nào
--           bị Filter loại. Buffers 898 (~7 MB). Execution Time 4,8 ms.
--
--   → 119× nhanh hơn, 125× ít buffer. Tổng số dòng chạm vào: 89.883 → 249.
--
-- Plan cũng xác nhận `(SELECT is_admin_auth(auth.uid()))` thành InitPlan chạy đúng 1 lần thay
-- vì 41.021 lời gọi. Ngược lại, bọc riêng `auth.uid()` là thừa: planner vốn đã tự nâng nó lên
-- InitPlan ở CẢ bản cũ — giữ lại chỉ vì vô hại và đọc cho rõ ý.
--
-- Cách kiểm lại (chạy trong SQL editor, thay <uuid> bằng address thật, so 2 lần trước/sau):
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT o.id, oi.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
--   WHERE o.address_id = '<uuid>' AND o.created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh');
-- (chạy dưới role `authenticated` với JWT thật thì RLS mới áp — dùng Supabase SQL editor ở chế
--  độ impersonate user, không phải service_role, nếu không policy bị bỏ qua và số đo vô nghĩa.)
-- ==============================================================================================

BEGIN;

DROP POLICY IF EXISTS "managers_order_items" ON order_items;
CREATE POLICY "managers_order_items" ON order_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = order_items.order_id
              AND (
                  (SELECT public.is_admin_auth(auth.uid()))
                  OR o.address_id IN (
                      SELECT address_id FROM user_address_access
                      WHERE auth_id = (SELECT auth.uid())
                  )
              )
        )
    );

COMMIT;
