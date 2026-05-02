-- Add ON DELETE CASCADE to shift_closings.address_id FK so deleting an
-- address removes its historical shift closing reports. Every other table
-- referencing addresses already cascades; this was an oversight when the
-- shift_closings table was added.

ALTER TABLE shift_closings
  DROP CONSTRAINT IF EXISTS shift_closings_address_id_fkey;

ALTER TABLE shift_closings
  ADD CONSTRAINT shift_closings_address_id_fkey
  FOREIGN KEY (address_id) REFERENCES addresses(id) ON DELETE CASCADE;
