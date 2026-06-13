-- Thêm 2 nhóm nhãn chi phí: 'inventory' (Chi phí tồn kho) + 'non_operating' (Ngoài kinh doanh).
--
-- group_section trước giờ chỉ 'operating' | 'overhead' (CHECK constraint chặn). Nới ra 4 giá trị.
--   - inventory:     defaults "Mua nguyên liệu" + "Mua bao bì" — chi mua vật tư KHÔNG kiểm kê.
--                    Báo cáo: Dòng tiền → section Tồn kho; Lợi nhuận → 1 dòng "Chi phí tồn kho".
--   - non_operating: default "Rút vốn / cá nhân" — tiền ra ngoài hoạt động KD.
--                    Báo cáo: Dòng tiền → section riêng; Lợi nhuận → KHÔNG hiện, KHÔNG trừ.
--
-- ⚠️ Unique index idx_expense_categories_unique_name (address_id, lower(name)) WHERE is_active
-- cấm TRÙNG TÊN trong cùng địa chỉ BẤT KỂ nhóm. Vì vậy KHÔNG seed thêm "Chi phí khác" cho
-- nhóm mới (đã có ở operating). Mọi insert chèn TỪNG DÒNG kèm guard tên-toàn-cục (bỏ qua nếu
-- tên đã tồn tại) — an toàn kể cả khi địa chỉ đã có nhãn tự tạo trùng tên.
--
-- CLAUDE.md: seed_default_expense_categories đã hardening (SET search_path=public + REVOKE
-- EXECUTE FROM PUBLIC/anon/authenticated). CREATE OR REPLACE làm RƠI search_path → khai báo
-- lại; re-REVOKE cho chắc.

BEGIN;

-- ── 1. Nới CHECK constraint group_section ─────────────────────────────────────
ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_group_section_check;
ALTER TABLE expense_categories ADD CONSTRAINT expense_categories_group_section_check
    CHECK (group_section IN ('operating', 'overhead', 'inventory', 'non_operating'));

-- ── 2. Seed fn cho address MỚI (chèn từng dòng, guard trùng tên toàn-cục) ─────
-- Bỏ "Chi phí khác" của overhead (vốn trùng operating → bị index chặn); fallback "Chi phí
-- khác" của báo cáo lợi nhuận chỉ dùng bản operating nên không ảnh hưởng.
CREATE OR REPLACE FUNCTION seed_default_expense_categories(p_address_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v RECORD;
BEGIN
    IF EXISTS (
        SELECT 1 FROM expense_categories
        WHERE address_id = p_address_id AND is_default = TRUE
    ) THEN
        RETURN;
    END IF;

    FOR v IN
        SELECT * FROM (VALUES
            ('Lương nhân viên',      'operating',     10),
            ('Thuê mặt bằng',        'operating',     20),
            ('Điện nước',            'operating',     30),
            ('Marketing',            'operating',     40),
            ('Phần mềm / Hệ thống',  'operating',     50),
            ('Chi phí khác',         'operating',     999),
            ('Lương quản lý',        'overhead',      10),
            ('Khấu hao máy móc',     'overhead',      20),
            ('Chi phí tài chính',    'overhead',      30),
            ('Mua nguyên liệu',      'inventory',     10),
            ('Mua bao bì',           'inventory',     20),
            ('Rút vốn / cá nhân',    'non_operating', 10)
        ) AS t(name, grp, so)
    LOOP
        INSERT INTO expense_categories (address_id, name, group_section, sort_order, is_default)
        SELECT p_address_id, v.name, v.grp, v.so, TRUE
        WHERE NOT EXISTS (
            SELECT 1 FROM expense_categories c
            WHERE c.address_id = p_address_id AND lower(c.name) = lower(v.name) AND c.is_active
        );
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION seed_default_expense_categories(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. Backfill defaults nhóm mới cho address ĐÃ CÓ (cùng guard toàn-cục) ─────
DO $$
DECLARE
    addr RECORD;
    v    RECORD;
BEGIN
    FOR addr IN SELECT id FROM addresses LOOP
        FOR v IN
            SELECT * FROM (VALUES
                ('Mua nguyên liệu',   'inventory',     10),
                ('Mua bao bì',        'inventory',     20),
                ('Rút vốn / cá nhân', 'non_operating', 10)
            ) AS t(name, grp, so)
        LOOP
            INSERT INTO expense_categories (address_id, name, group_section, sort_order, is_default)
            SELECT addr.id, v.name, v.grp, v.so, TRUE
            WHERE NOT EXISTS (
                SELECT 1 FROM expense_categories c
                WHERE c.address_id = addr.id AND lower(c.name) = lower(v.name) AND c.is_active
            );
        END LOOP;
    END LOOP;
END $$;

COMMIT;
