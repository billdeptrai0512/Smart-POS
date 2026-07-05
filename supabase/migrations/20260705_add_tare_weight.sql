-- Khối lượng bì (tare): hộp/chai đựng NVL tại quầy (vd hộp thiếc matcha 70g,
-- chai nhựa sữa đặc). Cân kiểm kê cuối ca không tare được (hộp đang đầy) nên
-- nhân viên cân GỘP cả bì — UI ô "Cuối kỳ" trừ bì rồi lưu số NET vào
-- shift_closings.inventory_report (downstream: dự báo/hao hụt/min_stock đều
-- chạy trên net, không đổi). NULL/0 = không có bì.

BEGIN;

ALTER TABLE ingredient_costs
    ADD COLUMN IF NOT EXISTS tare_weight NUMERIC NULL;

-- Propagate tare_weight when seeding a new address from the default template.
-- (CREATE OR REPLACE làm rơi SET search_path — khai báo lại; signature không đổi
-- nên grants giữ nguyên, re-grant cho chắc theo pattern 20260523.)
CREATE OR REPLACE FUNCTION seed_default_ingredient_costs(p_address_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_address_id IS NULL THEN RETURN; END IF;
    INSERT INTO ingredient_costs (ingredient, unit, unit_cost, address_id, pack_size, pack_unit, min_stock, category, tare_weight)
    SELECT d.ingredient, d.unit, d.unit_cost, p_address_id, d.pack_size, d.pack_unit, d.min_stock, d.category, d.tare_weight
    FROM ingredient_costs d
    WHERE d.address_id IS NULL
    ON CONFLICT (ingredient, address_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION seed_default_ingredient_costs(UUID) TO authenticated;

COMMIT;
