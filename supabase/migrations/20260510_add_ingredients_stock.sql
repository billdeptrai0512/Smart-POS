CREATE OR REPLACE FUNCTION ensure_ingredients_stock()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ingredients' AND column_name='stock'
  ) THEN
    ALTER TABLE ingredients ADD COLUMN stock NUMERIC DEFAULT 0;
  END IF;
END;
$$;

SELECT ensure_ingredients_stock();
