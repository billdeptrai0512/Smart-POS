DROP FUNCTION IF EXISTS subtract_stock_from_restock();
DROP TRIGGER IF EXISTS trg_subtract_stock ON shift_closings;

CREATE OR REPLACE FUNCTION subtract_stock_from_restock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    rec jsonb;
    ing text;
    qty numeric;
BEGIN
    -- Loop through each ingredient in the new shift closing report
    FOR rec IN SELECT jsonb_array_elements(NEW.inventory_report) LOOP
        ing := rec->>'ingredient';
        qty := (rec->>'restock')::numeric;
        IF qty > 0 THEN
            UPDATE inventory
            SET stock = stock - qty
            WHERE ingredient = ing;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subtract_stock
AFTER INSERT ON shift_closings
FOR EACH ROW EXECUTE FUNCTION subtract_stock_from_restock();
