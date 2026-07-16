-- ==============================================================================================
-- 20260716_fix_order_items_product_fk_cascade.sql
-- Xoá địa chỉ báo lỗi: "update or delete on table products violates foreign key
-- constraint order_items_product_id_fkey on table order_items".
--
-- addresses.id CASCADE → products.owner_address_id CASCADE, và cũng CASCADE →
-- orders.address_id → order_items.order_id. Cả 2 nhánh cascade cùng chạy trong 1
-- statement DELETE FROM addresses, nhưng order_items.product_id chưa từng có
-- ON DELETE CASCADE/SET NULL (thiếu từ schema gốc) — Postgres check constraint
-- này ngay khi nhánh xoá products chạy tới, trước khi nhánh orders->order_items
-- kịp xoá xong dòng order_items đang tham chiếu → xoá địa chỉ luôn thất bại nếu
-- địa chỉ đó đã có đơn hàng.
--
-- Xoá 1 địa chỉ vốn đã xoá sạch orders của địa chỉ đó (cascade từ addresses), nên
-- CASCADE thêm ở đây không mất dữ liệu nào ngoài dữ liệu vốn đã bị xoá cùng lúc.
-- Sản phẩm không bao giờ bị hard-delete ngoài luồng xoá-cả-địa-chỉ (removeProductFromAddress
-- chỉ soft-delete qua is_active=false — src/services/productService.js), nên FK
-- này không còn tác dụng bảo vệ nào bị mất khi đổi sang CASCADE.
--
-- NOT VALID + VALIDATE CONSTRAINT riêng: ADD CONSTRAINT thường quét toàn bộ
-- order_items để validate lại, giữ lock trong lúc quét — chặn ghi đơn hàng mới nếu
-- ai đó đang bán hàng đúng lúc chạy. Dữ liệu hiện có chắc chắn đã hợp lệ (constraint
-- cũ luôn validate lúc INSERT, chỉ chặn lúc DELETE), nên validate lại là thừa —
-- NOT VALID bỏ qua bước quét đó, VALIDATE CONSTRAINT sau đó chỉ cần lock nhẹ.
-- ==============================================================================================

BEGIN;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    NOT VALID;

ALTER TABLE order_items VALIDATE CONSTRAINT order_items_product_id_fkey;

COMMIT;
