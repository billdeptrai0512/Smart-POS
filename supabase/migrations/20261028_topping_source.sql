-- Topping trỏ vào 1 NGUỒN tồn kho (nguyên liệu mua sẵn hoặc thành phẩm) — xem docs/BATCH_AND_TOPPING.md §5.
-- source_ingredient: khoá ingredient_costs của nguồn; source_amount: lượng nguồn cho 1 phần topping.
-- Cả hai nullable: topping chưa gán nguồn giữ nguyên hành vi cũ (giá vốn theo topping_ingredients, không trừ tồn).
-- Không đụng function nào nên không vướng rule search_path/REVOKE.
ALTER TABLE toppings
  ADD COLUMN IF NOT EXISTS source_ingredient TEXT,
  ADD COLUMN IF NOT EXISTS source_amount NUMERIC;

-- Gán nguồn thì phải có định lượng > 0 (và ngược lại bỏ nguồn thì bỏ luôn định lượng).
ALTER TABLE toppings
  ADD CONSTRAINT toppings_source_pair CHECK (
    (source_ingredient IS NULL AND source_amount IS NULL)
    OR (source_ingredient IS NOT NULL AND source_amount > 0)
  );
