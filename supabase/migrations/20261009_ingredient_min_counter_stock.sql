-- Hai ngưỡng tồn tối thiểu: TỒN QUẦY ít nhất (cột mới) và TỒN KHO ít nhất (= min_stock hiện có).
-- min_stock trước đây so với TỔNG tồn (kho + quầy); nay mang nghĩa "tồn kho ít nhất" — giữ nguyên
-- giá trị, không cần chuyển dữ liệu. NULL = không đặt ngưỡng.
-- seed_default_ingredient_costs cố ý KHÔNG copy cột này (cùng lý do 20261008_ingredient_pack2).

ALTER TABLE ingredient_costs
    ADD COLUMN IF NOT EXISTS min_counter_stock NUMERIC NULL;
