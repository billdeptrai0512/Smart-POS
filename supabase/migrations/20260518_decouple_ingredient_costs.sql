-- Decouple ingredient_costs per address (align with products/recipes pattern).
-- Today: ingredient_costs uses a template+override model via OR address_id IS NULL
--   in the fetch query. Admin's edits to default rows propagate to ALL active
--   addresses; managers can't independently delete a default-only ingredient
--   from their list. Bug: tạo mới ingredient ở default tự lan sang address khác.
--
-- After this migration:
--   1) Each active address has its OWN ingredient_costs rows.
--   2) Default rows (address_id IS NULL) serve only as a guideline template
--      for guest mode + new-address seed (admin self-learn form).
--   3) A trigger seeds new addresses from default at creation time.
--   4) Admin can edit/create/delete default rows freely — no impact on active
--      addresses; they only get a copy at the moment of address creation.

BEGIN;

-- A. seed function ---------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_default_ingredient_costs(p_address_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_address_id IS NULL THEN RETURN; END IF;
    INSERT INTO ingredient_costs (ingredient, unit, unit_cost, address_id, pack_size, pack_unit, min_stock)
    SELECT d.ingredient, d.unit, d.unit_cost, p_address_id, d.pack_size, d.pack_unit, d.min_stock
    FROM ingredient_costs d
    WHERE d.address_id IS NULL
    ON CONFLICT (ingredient, address_id) DO NOTHING;
END;
$$;
GRANT EXECUTE ON FUNCTION seed_default_ingredient_costs(UUID) TO authenticated;

-- B. Backfill every existing active address. Skips ingredients the address
--    already overrides — those keep their (possibly customized) values.
DO $$
DECLARE
    a RECORD;
BEGIN
    FOR a IN SELECT id FROM addresses LOOP
        PERFORM seed_default_ingredient_costs(a.id);
    END LOOP;
END;
$$;

-- C. Trigger: auto-seed every NEW address at creation time.
CREATE OR REPLACE FUNCTION trigger_seed_address_ingredient_costs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM seed_default_ingredient_costs(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_address_ingredient_costs_trigger ON addresses;
CREATE TRIGGER seed_address_ingredient_costs_trigger
AFTER INSERT ON addresses
FOR EACH ROW EXECUTE FUNCTION trigger_seed_address_ingredient_costs();

COMMIT;
