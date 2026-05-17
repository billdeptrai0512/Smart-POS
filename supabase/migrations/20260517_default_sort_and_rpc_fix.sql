-- 1) Fix update_products_sort_order: products column is owner_address_id, not address_id.
--    The previous version threw 42703 (column doesn't exist) for every admin sort click.
-- 2) Add app_settings table to persist global defaults (default_ingredient_sort_order).
--    Public read = guests can inherit when starting the playground; admin-only write.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Fix update_products_sort_order column reference
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_products_sort_order(p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    -- Ownership guard via products.owner_address_id → addresses → user_address_access.
    -- Default-template products (owner_address_id IS NULL) skip the per-row check —
    -- they're admin-only by virtue of the products_write RLS on `is_admin_auth`.
    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM products p
        WHERE p.id = ANY(p_ids)
          AND (p.owner_address_id IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1 FROM addresses a
              WHERE a.id = p.owner_address_id
                AND (
                    public.is_admin_auth(auth.uid())
                    OR a.manager_id = public.auth_owner_id(auth.uid())
                    OR a.id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
                )
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for one or more products' USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE products SET sort_order = ord.idx - 1
    FROM unnest(p_ids) WITH ORDINALITY AS ord(id, idx)
    WHERE products.id = ord.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_products_sort_order(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_products_sort_order(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_products_sort_order(UUID[]) TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
-- 2. app_settings — singleton-key/JSONB-value store for global defaults
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::JSONB,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Public read so unauthenticated guests can fetch default ingredient sort order
-- during initGuestMode. Values stored here are template metadata, no PII.
DROP POLICY IF EXISTS "app_settings_read" ON app_settings;
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT USING (true);

-- Admin-only write (matches the "default address" admin workflow)
DROP POLICY IF EXISTS "app_settings_admin_write" ON app_settings;
CREATE POLICY "app_settings_admin_write" ON app_settings FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
);

-- Seed empty default so SELECT returns a row immediately (UX: no "first write" branch needed in JS)
INSERT INTO app_settings (key, value)
VALUES ('default_ingredient_sort_order', '[]'::JSONB)
ON CONFLICT (key) DO NOTHING;

COMMIT;
