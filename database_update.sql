[00:57:56 27/4/2026]
Thao tác: Xóa món khỏi menu
Lỗi: update or delete on table "products" violates foreign key constraint "order_items_product_id_fkey" on table "order_items"
Code: 23503
Details: Key is still referenced from table "order_items".
Trang: /recipes/972bc2c4-eb09-4710-8022-8d28e0be5cb8

-- Thêm cột is_hidden vào address_products để ghi đè ẩn đi các món mặc định
ALTER TABLE "public"."address_products" ADD COLUMN IF NOT EXISTS "is_hidden" boolean DEFAULT false;

-- Thêm cột sort_order vào products để hỗ trợ sắp xếp Mặc định
ALTER TABLE "public"."products" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 999999;