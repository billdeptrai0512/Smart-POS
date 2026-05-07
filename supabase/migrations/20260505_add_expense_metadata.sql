-- Add metadata column to expenses to track structured data like ingredient, quantity, etc.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Drop old views/functions that might select * from expenses and recreate if necessary
-- In this schema, we don't have views selecting * from expenses, so it's safe.
