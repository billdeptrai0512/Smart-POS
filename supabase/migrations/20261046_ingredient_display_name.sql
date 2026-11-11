-- Tên hiển thị nguyên liệu do người dùng gõ (giữ nguyên hoa/thường, từ viết tắt như "BTP").
-- `ingredient` vẫn là key định danh (lowercase_snake) dùng ở công thức/tồn kho; display_name chỉ để hiển thị.
-- NULL = chưa đặt → client tự suy ra từ key như trước. Không đụng function nào nên không cần search_path/REVOKE.
ALTER TABLE public.ingredient_costs
    ADD COLUMN IF NOT EXISTS display_name text;
