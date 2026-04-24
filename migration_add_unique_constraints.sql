-- ================================================================
-- Migration: Clean duplicates + add unique constraints
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ================================================================

-- Step 1: Remove duplicate recipes (keep newest id per group)
DELETE FROM recipes
WHERE id NOT IN (
    SELECT DISTINCT ON (product_id, ingredient, address_id) id
    FROM recipes
    ORDER BY product_id, ingredient, address_id, id DESC
);

-- Step 2: Remove duplicate ingredient_costs (keep newest id per group)
DELETE FROM ingredient_costs
WHERE id NOT IN (
    SELECT DISTINCT ON (ingredient, address_id) id
    FROM ingredient_costs
    ORDER BY ingredient, address_id, id DESC
);

-- Step 3: Remove duplicate product_prices (keep newest id per group)
DELETE FROM product_prices
WHERE id NOT IN (
    SELECT DISTINCT ON (product_id, address_id) id
    FROM product_prices
    ORDER BY product_id, address_id, id DESC
);

-- Step 4: Remove duplicate extra_ingredients (keep newest id per group)
DELETE FROM extra_ingredients
WHERE id NOT IN (
    SELECT DISTINCT ON (extra_id, ingredient) id
    FROM extra_ingredients
    ORDER BY extra_id, ingredient, id DESC
);

-- Step 5: Add unique constraints (safe to re-run)
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_prices_product_address
    ON product_prices (product_id, address_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_product_ingredient_address
    ON recipes (product_id, ingredient, address_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ingredient_costs_ingredient_address
    ON ingredient_costs (ingredient, address_id) NULLS NOT DISTINCT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_extra_ingredients_extra_ingredient
    ON extra_ingredients (extra_id, ingredient);
