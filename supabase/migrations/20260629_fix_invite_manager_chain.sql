-- ============================================================
-- Fix Bug 1: staff/co-manager do CO-MANAGER mời bị trỏ manager_id vào người mời
-- (link mời cũ nhúng id của người tạo — AddressSelectPage trước đây dùng profile.id)
-- nên auth_owner_id không khớp chủ địa chỉ → KHÔNG share chung địa chỉ.
--
-- Phía client đã sửa để link mời gắn vào top manager. Migration này reparent
-- data cũ: mỗi user về đúng "owner" cao nhất (user có manager_id IS NULL).
-- Trigger trg_uaa_on_user_change tự rebuild user_address_access khi manager_id đổi.
--
-- Chỉ UPDATE manager_id (không xoá gì). IDEMPOTENT: chạy lại = 0 dòng.
-- Không đụng admin (manager_id của admin không ảnh hưởng bug này).
-- ============================================================

BEGIN;

WITH RECURSIVE owner_of AS (
    -- gốc: các top manager (và bất kỳ ai chưa có manager_id)
    SELECT id, id AS owner_id FROM users WHERE manager_id IS NULL
    UNION ALL
    -- leo chuỗi: con kế thừa owner của cha
    SELECT u.id, o.owner_id FROM users u JOIN owner_of o ON u.manager_id = o.id
)
UPDATE users
SET manager_id = owner_of.owner_id
FROM owner_of
WHERE users.id = owner_of.id
  AND users.role IN ('staff', 'manager')
  AND users.manager_id IS NOT NULL
  AND users.manager_id IS DISTINCT FROM owner_of.owner_id;

COMMIT;
