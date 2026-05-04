-- Add is_refill flag and payment_method to expenses table
-- is_refill=true marks an expense as "Mua nguyên vật liệu" (refill) — these are
-- excluded from netProfit because COGS already represents material cost via recipe.
-- payment_method tracks whether the expense was paid in cash (rút từ két)
-- or via transfer (CK), used to compute "tiền cầm về thực" correctly.
-- Defaults ensure backward compatibility: all existing rows become non-refill cash.

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS is_refill BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash', 'transfer'));
