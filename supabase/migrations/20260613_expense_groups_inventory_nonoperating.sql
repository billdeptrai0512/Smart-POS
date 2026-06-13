-- Thêm 2 nhóm nhãn chi phí: 'inventory' (Chi phí tồn kho) + 'non_operating' (Ngoài kinh doanh).
--
-- group_section trước giờ chỉ 'operating' | 'overhead' (CHECK constraint chặn). Nới ra 4 giá trị.
--   - inventory:     defaults "Mua nguyên liệu" + "Mua bao bì" — chi mua vật tư KHÔNG kiểm kê.
--                    Báo cáo: Dòng tiền → section Tồn kho; Lợi nhuận → 1 dòng "Chi phí tồn kho".
--   - non_operating: default "Chi phí khác" — tiền ra ngoài hoạt động KD (rút vốn, chi cá nhân…).
--                    Báo cáo: Dòng tiền → section riêng; Lợi nhuận → KHÔNG hiện, KHÔNG trừ.
--
-- CLAUDE.md: seed_default_expense_categories đã được hardening (SET search_path=public +
-- REVOKE EXECUTE FROM PUBLIC/anon/authenticated ở 20260603). CREATE OR REPLACE làm RƠI
-- search_path → khai báo lại trong định nghĩa; re-REVOKE cho chắc (signature không đổi nên
-- grant thực ra giữ nguyên, revoke lại là idempotent).

BEGIN;

-- ── 1. Nới CHECK constraint group_section ─────────────────────────────────────
ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_group_section_check;
ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_group_section_check
    CHECK (group_section IN ('operating', 'overhead', 'inventory', 'non_operating'));

-- ── 2. Seed fn cho address MỚI (thêm defaults 2 nhóm mới) ─────────────────────
CREATE OR REPLACE FUNCTION seed_default_expense_categories(p_address_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM expense_categories
        WHERE address_id = p_address_id AND is_default = TRUE
    ) THEN
        RETURN;
    END IF;

    INSERT INTO expense_categories (address_id, name, group_section, sort_order, is_default)
    VALUES
        -- Operating (Chi phí vận hành)
        (p_address_id, 'Lương nhân viên',      'operating', 10, TRUE),
        (p_address_id, 'Thuê mặt bằng',        'operating', 20, TRUE),
        (p_address_id, 'Điện nước',            'operating', 30, TRUE),
        (p_address_id, 'Marketing',            'operating', 40, TRUE),
        (p_address_id, 'Phần mềm / Hệ thống',  'operating', 50, TRUE),
        (p_address_id, 'Chi phí khác',         'operating', 999, TRUE),
        -- Overhead (Chi phí quản lý & khác)
        (p_address_id, 'Lương quản lý',        'overhead',  10, TRUE),
        (p_address_id, 'Khấu hao máy móc',     'overhead',  20, TRUE),
        (p_address_id, 'Chi phí tài chính',    'overhead',  30, TRUE),
        (p_address_id, 'Chi phí khác',         'overhead',  999, TRUE),
        -- Inventory (Chi phí tồn kho) — mua vật tư không kiểm kê
        (p_address_id, 'Mua nguyên liệu',      'inventory', 10, TRUE),
        (p_address_id, 'Mua bao bì',           'inventory', 20, TRUE),
        -- Non-operating (Ngoài kinh doanh)
        (p_address_id, 'Chi phí khác',         'non_operating', 999, TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_default_expense_categories(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Backfill defaults nhóm mới cho address ĐÃ CÓ ───────────────────────────
-- (seed fn early-return với address đã có defaults nên không tự thêm — chèn thủ công,
--  bỏ qua nếu đã tồn tại để idempotent.)
DO $$
DECLARE addr RECORD;
BEGIN
    FOR addr IN SELECT id FROM addresses LOOP
        INSERT INTO expense_categories (address_id, name, group_section, sort_order, is_default)
        SELECT addr.id, v.name, 'inventory', v.so, TRUE
        FROM (VALUES ('Mua nguyên liệu', 10), ('Mua bao bì', 20)) AS v(name, so)
        WHERE NOT EXISTS (
            SELECT 1 FROM expense_categories c
            WHERE c.address_id = addr.id AND c.group_section = 'inventory' AND c.name = v.name
        );

        INSERT INTO expense_categories (address_id, name, group_section, sort_order, is_default)
        SELECT addr.id, 'Chi phí khác', 'non_operating', 999, TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM expense_categories c
            WHERE c.address_id = addr.id AND c.group_section = 'non_operating'
        );
    END LOOP;
END $$;

COMMIT;
