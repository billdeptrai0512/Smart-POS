-- ============================================================
-- Gắn lại trigger trg_grant_trial_on_address_creation — 2026-06-20
--
-- BUG: hàm grant_trial_on_address_creation() tồn tại & đúng bản (20260611),
-- NHƯNG trigger gắn vào bảng addresses bị thiếu (pg_trigger không có dòng nào)
-- → tạo chi nhánh KHÔNG cấp trial dù owner đã có SĐT.
--
-- Nguyên nhân: migration 20260611 chỉ CREATE OR REPLACE FUNCTION (giả định
-- trigger còn từ 20260512). Trigger đã rơi đâu đó → cơ chế tự cấp trial chết.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

DROP TRIGGER IF EXISTS trg_grant_trial_on_address_creation ON addresses;
CREATE TRIGGER trg_grant_trial_on_address_creation
AFTER INSERT ON addresses
FOR EACH ROW
EXECUTE FUNCTION grant_trial_on_address_creation();
