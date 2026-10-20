-- Thành phẩm: 1 dòng `products` có is_batch = true; công thức mẻ = các dòng `recipes` của nó; batch_yield = sản lượng 1 mẻ
-- (đơn vị của nguyên liệu cùng tên trong ingredient_costs, nên thành phẩm tự có mặt ở Kiểm kê và bộ chọn nguyên liệu).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_batch    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batch_yield NUMERIC;
