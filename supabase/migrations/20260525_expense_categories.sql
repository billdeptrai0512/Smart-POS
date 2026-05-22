-- Expense categories (tags) — Phase 1 of expense schema refactor.
--
-- Replaces the flat 6+3 hardcoded category list in FinanceCards with
-- per-address user-managed tags. Each expense (and each fixed_costs row) gets
-- an optional category_id pointing here. Reports group spend by category
-- inside one of two sections:
--   - 'operating' → subtracted before Lợi nhuận vận hành
--   - 'overhead'  → subtracted before Lợi nhuận ròng
--
-- Legacy is_fixed / is_refill columns are KEPT untouched — RPCs and aggregator
-- code still depend on them. category_id is additive, not a replacement.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id    UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    group_section TEXT NOT NULL CHECK (group_section IN ('operating', 'overhead')),
    sort_order    INT  NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,  -- seeded vs manager-created
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active categories per address (read path)
CREATE INDEX IF NOT EXISTS idx_expense_categories_address_active
    ON expense_categories (address_id, sort_order)
    WHERE is_active;

-- Used by backfill + lookups (find the seed "Chi phí khác" row for an address)
CREATE INDEX IF NOT EXISTS idx_expense_categories_default_lookup
    ON expense_categories (address_id, group_section, is_default);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Foreign-key columns on existing tables
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE expenses
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;

ALTER TABLE fixed_costs
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_fixed_costs_category ON fixed_costs (category_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — manager + admin only, scoped via user_address_access
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_expense_categories" ON expense_categories;
CREATE POLICY "managers_expense_categories" ON expense_categories
    FOR ALL USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed function — 6 operating + 3 overhead defaults per address
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent: skips if any default categories already exist for the address.
-- Returns the IDs of the two "Chi phí khác" defaults (operating, overhead) so
-- backfill can use them for legacy uncategorized expenses.
CREATE OR REPLACE FUNCTION seed_default_expense_categories(p_address_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM expense_categories
        WHERE address_id = p_address_id AND is_default = TRUE
    ) THEN
        RETURN;
    END IF;

    INSERT INTO expense_categories (address_id, name, group_section, sort_order, is_default)
    VALUES
        -- Operating (Chi phí vận hành) — mirrors current FinanceCards mockup
        (p_address_id, 'Lương nhân viên',      'operating', 10, TRUE),
        (p_address_id, 'Thuê mặt bằng',        'operating', 20, TRUE),
        (p_address_id, 'Điện nước',            'operating', 30, TRUE),
        (p_address_id, 'Marketing',            'operating', 40, TRUE),
        (p_address_id, 'Phần mềm / Hệ thống',  'operating', 50, TRUE),
        (p_address_id, 'Chi phí khác',         'operating', 999, TRUE),
        -- Overhead (Chi phí quản lý & khác)
        (p_address_id, 'Lương quản lý',        'overhead',  10, TRUE),
        (p_address_id, 'Khấu hao máy móc',     'overhead',  20, TRUE),
        (p_address_id, 'Chi phí tài chính',    'overhead',  30, TRUE),
        (p_address_id, 'Chi phí khác',         'overhead',  999, TRUE);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Auto-seed on new address insert
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_seed_expense_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    PERFORM seed_default_expense_categories(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_expense_categories_on_address ON addresses;
CREATE TRIGGER trg_seed_expense_categories_on_address
AFTER INSERT ON addresses
FOR EACH ROW
EXECUTE FUNCTION trg_seed_expense_categories();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Backfill existing addresses + expenses
-- ─────────────────────────────────────────────────────────────────────────────
-- 6a. Seed every existing address.
DO $$
DECLARE
    addr RECORD;
BEGIN
    FOR addr IN SELECT id FROM addresses LOOP
        PERFORM seed_default_expense_categories(addr.id);
    END LOOP;
END $$;

-- 6b. Assign category_id to existing expenses.
--   - is_refill=true + metadata.ingredient → NULL (NVL belongs to COGS, not a category)
--   - is_fixed=true → "Chi phí khác" operating (manager can re-tag later;
--                    we don't auto-link by fixed_costs.name because a user-renamed
--                    seed could collide with another category)
--   - everything else (is_fixed=false, not refill, or free-form refill) →
--                     "Chi phí khác" operating
-- Two passes keep the SQL readable.
UPDATE expenses e
SET category_id = c.id
FROM expense_categories c
WHERE e.category_id IS NULL
  AND c.address_id = e.address_id
  AND c.group_section = 'operating'
  AND c.is_default = TRUE
  AND c.name = 'Chi phí khác'
  AND (
      -- Manual in-shift expense
      (e.is_fixed = FALSE AND e.is_refill = FALSE)
      -- Auto-injected fixed cost
      OR (e.is_fixed = TRUE)
      -- Free-form after-shift expense (still operational, not NVL)
      OR (e.is_refill = TRUE AND (e.metadata->>'free_form')::boolean IS TRUE)
  );
-- NVL refills intentionally left with category_id = NULL.

-- 6c. fixed_costs templates → same default for now. Manager can re-tag in UI.
UPDATE fixed_costs fc
SET category_id = c.id
FROM expense_categories c
WHERE fc.category_id IS NULL
  AND c.address_id = fc.address_id
  AND c.group_section = 'operating'
  AND c.is_default = TRUE
  AND c.name = 'Chi phí khác';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. updated_at touch trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_touch_expense_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_expense_categories ON expense_categories;
CREATE TRIGGER trg_touch_expense_categories
BEFORE UPDATE ON expense_categories
FOR EACH ROW
EXECUTE FUNCTION trg_touch_expense_categories_updated_at();

COMMIT;
