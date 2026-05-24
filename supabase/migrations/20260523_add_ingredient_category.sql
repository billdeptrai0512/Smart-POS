-- Add nullable `category` to ingredient_costs so managers can group NVL
-- into "Nguyên liệu chính / Bao bì / Đồ dùng dụng cụ" — surfaced as a
-- "Báo cáo" sub-tab in /ingredients.
--
-- Nullable on purpose: existing rows stay uncategorized until a manager
-- assigns them (UX choice — see chat decision: do not auto-classify by name).

BEGIN;

ALTER TABLE ingredient_costs
    ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE ingredient_costs
    DROP CONSTRAINT IF EXISTS ingredient_costs_category_check;

ALTER TABLE ingredient_costs
    ADD CONSTRAINT ingredient_costs_category_check
    CHECK (category IS NULL OR category IN ('main', 'packaging', 'tools'));

-- Propagate category when seeding a new address from the default template.
CREATE OR REPLACE FUNCTION seed_default_ingredient_costs(p_address_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_address_id IS NULL THEN RETURN; END IF;
    INSERT INTO ingredient_costs (ingredient, unit, unit_cost, address_id, pack_size, pack_unit, min_stock, category)
    SELECT d.ingredient, d.unit, d.unit_cost, p_address_id, d.pack_size, d.pack_unit, d.min_stock, d.category
    FROM ingredient_costs d
    WHERE d.address_id IS NULL
    ON CONFLICT (ingredient, address_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION seed_default_ingredient_costs(UUID) TO authenticated;

COMMIT;
