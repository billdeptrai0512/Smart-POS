-- Cờ per-ingredient: có đưa nguyên liệu/bao bì vào list kiểm kê hao hụt tồn kho (thẻ
-- "Hao hụt" lúc chốt ca) hay không. Mặc định TRUE → mọi nguyên liệu hiện có vẫn được
-- kiểm kê như cũ. Tắt cho những thứ không cần đếm cuối ca.

ALTER TABLE ingredient_costs
    ADD COLUMN IF NOT EXISTS count_in_audit boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN ingredient_costs.count_in_audit IS
    'Có hiển thị nguyên liệu này trong list kiểm kê hao hụt (chốt ca) không. Mặc định true.';
