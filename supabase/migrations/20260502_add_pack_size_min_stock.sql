-- Add pack size, pack unit, and min stock to ingredient_costs table
-- This allows calculating refill targets in standard retail packaging (e.g. "bịch 500g")
-- Defaulting to NULL ensures 100% backward compatibility for existing features.

ALTER TABLE ingredient_costs
ADD COLUMN IF NOT EXISTS pack_size NUMERIC NULL,
ADD COLUMN IF NOT EXISTS pack_unit TEXT NULL,
ADD COLUMN IF NOT EXISTS min_stock NUMERIC NULL;
