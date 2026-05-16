-- ==============================================================================================
-- 20260524_batch_sort_order.sql
-- Reduce reorder ops from N round-trips to 1.
--
-- Before: updateProductSortOrder and updateExtrasSortOrder fire N parallel UPDATE
-- requests through PostgREST. Each request pays per-call overhead (auth check, RLS
-- re-eval, row-level lock acquisition, response framing). 10 items reordered ≈ 10×
-- request cost even though only 1 round-trip's worth of useful work is done.
--
-- After: 1 RPC per reorder. UPDATE FROM unnest(...) WITH ORDINALITY sets each row's
-- sort_order to its position in the input array in a single statement.
-- ==============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Products
-- ---------------------------------------------------------------------------
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

    -- Ownership guard via products → addresses → user_address_access.
    -- Skip when auth.uid() IS NULL (service_role / migrations bypass).
    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM products p
        WHERE p.id = ANY(p_ids)
          AND (p.address_id IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1 FROM addresses a
              WHERE a.id = p.address_id
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


-- ---------------------------------------------------------------------------
-- 2. Product extras
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_extras_sort_order(p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    -- Ownership guard via product_extras → addresses → user_address_access.
    IF auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM product_extras pe
        WHERE pe.id = ANY(p_ids)
          AND (pe.address_id IS NOT NULL)
          AND NOT EXISTS (
              SELECT 1 FROM addresses a
              WHERE a.id = pe.address_id
                AND (
                    public.is_admin_auth(auth.uid())
                    OR a.manager_id = public.auth_owner_id(auth.uid())
                    OR a.id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
                )
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for one or more extras' USING ERRCODE = 'insufficient_privilege';
    END IF;

    UPDATE product_extras SET sort_order = ord.idx - 1
    FROM unnest(p_ids) WITH ORDINALITY AS ord(id, idx)
    WHERE product_extras.id = ord.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_extras_sort_order(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_extras_sort_order(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_extras_sort_order(UUID[]) TO authenticated;

COMMIT;
