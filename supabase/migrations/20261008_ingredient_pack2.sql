-- Quy cách đóng gói cấp 2: 1 [pack2_unit] = [pack2_size] [pack_unit].
-- Vd: 1 hộp = 1286 ml (pack_size/pack_unit, cấp 1) và 1 thùng = 12 hộp (cấp 2).
-- pack2_size tính theo CẤP 1 (không phải đơn vị gốc) → sửa kích thước hộp thì thùng tự đổi theo.
-- NULL cả hai = không có cấp 2 (mọi dòng hiện có giữ nguyên).
-- seed_default_ingredient_costs cố ý KHÔNG copy cấp 2 (địa chỉ mới từ template chưa có cấp 2,
-- cài lại ở modal Quy cách) — đỡ đụng lại hàm nội bộ nhạy cảm; thêm khi thật sự cần.

ALTER TABLE ingredient_costs
    ADD COLUMN IF NOT EXISTS pack2_size NUMERIC NULL,
    ADD COLUMN IF NOT EXISTS pack2_unit TEXT NULL;
