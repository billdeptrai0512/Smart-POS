DROP TRIGGER IF EXISTS trg_subtract_stock ON shift_closings;
DROP FUNCTION IF EXISTS subtract_stock_from_restock() CASCADE;
CREATE OR REPLACE FUNCTION subtract_stock_from_restock()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    rec jsonb;
    ing text;
    qty numeric;
BEGIN
    FOR rec IN SELECT jsonb_array_elements(NEW.inventory_report) LOOP
        ing := rec->>'ingredient';
        qty := (rec->>'restock')::numeric;
        IF qty > 0 THEN
            UPDATE inventory
            SET stock = stock - qty + COALESCE((rec->>'remaining')::numeric, 0)
            WHERE ingredient = ing;
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_subtract_stock
AFTER INSERT ON shift_closings
FOR EACH ROW EXECUTE FUNCTION subtract_stock_from_restock();
