-- =============================================
-- shift_closings.address_id: cho phép NULL (Mẫu mặc định)
-- =============================================
-- Admin sửa "Tồn quầy" / "Lưu báo cáo" trên "Mẫu mặc định" (template dùng chung,
-- address_id = NULL — cùng model với products/recipes/ingredient_costs) đều thất
-- bại với lỗi 23502 "null value in column address_id violates not-null constraint",
-- vì shift_closings tạo từ đầu với address_id UUID NOT NULL, khác các bảng kia.
--
-- RLS "managers_shift_closings" (20260503_fix_disk_io.sql) đã dùng
-- `is_admin_auth(auth.uid()) OR address_id IN (...)` — admin bypass không phụ
-- thuộc giá trị address_id, nên chỉ cần nới NOT NULL là đủ, không cần đổi policy.
--
-- Lưu ý: unique index uniq_shift_closings_address_vn_day (address_id, vn_business_date)
-- không chặn nhiều hàng address_id IS NULL cùng ngày (Postgres coi NULL <> NULL trong
-- unique index) — chấp nhận được vì chỉ admin thao tác trên template, không có
-- nhiều thiết bị/nhân viên chốt ca đồng thời như địa chỉ thật.

ALTER TABLE shift_closings ALTER COLUMN address_id DROP NOT NULL;
