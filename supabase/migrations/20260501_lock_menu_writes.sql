-- =============================================
-- Tighten write access on menu / config tables
-- =============================================
-- Current state (pre-migration): most "_write" policies are
--     FOR ALL USING (auth.uid() IS NOT NULL)
-- which means any authenticated user — including cashiers (role='staff') —
-- can INSERT/UPDATE/DELETE products, recipes, costs, extras, etc. The UI
-- normally hides those buttons via `canEdit`, but a missed UI gate (or a
-- handcrafted REST call) lets a staff account mutate the menu.
--
-- This migration:
--   1. Adds is_manager_auth() helper (managers + admins).
--   2. Replaces _write policies on the menu/config tables with checks that
--      require the caller to be a manager (or admin) AND, where applicable,
--      to have access to the target tenant's addresses.
--
-- The flat user_address_access table from the RLS denormalization migration
-- is the source of truth for tenant access — same as the read policies.
--
-- Safe to run multiple times: CREATE OR REPLACE / DROP IF EXISTS.

-- ---------------------------------------------------------------------------
-- Helper: is the caller a manager (or admin)?
-- Co-managers have role='manager' so they pass automatically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_manager_auth(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users
        WHERE auth_id = uid
          AND role IN ('manager', 'admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_manager_auth(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- products: only managers of the owning address may write.
-- Default-template products (owner_address_id IS NULL) are admin-only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_write" ON products
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND owner_address_id IS NOT NULL
            AND owner_address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND owner_address_id IS NOT NULL
            AND owner_address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    );


-- ---------------------------------------------------------------------------
-- recipes: same shape as products. address_id IS NULL = default template.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "recipes_write" ON recipes;
CREATE POLICY "recipes_write" ON recipes
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    );


-- ---------------------------------------------------------------------------
-- ingredient_costs: same shape as recipes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "costs_write" ON ingredient_costs;
CREATE POLICY "costs_write" ON ingredient_costs
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    );


-- ---------------------------------------------------------------------------
-- product_extras: same shape as recipes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "extras_write" ON product_extras;
CREATE POLICY "extras_write" ON product_extras
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    );


-- ---------------------------------------------------------------------------
-- extra_ingredients: linked to product_extras via extra_id (no own address).
-- Resolve tenancy through the parent extra row.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "extra_ings_write" ON extra_ingredients;
CREATE POLICY "extra_ings_write" ON extra_ingredients
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = auth.uid()
                  )
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access
                      WHERE auth_id = auth.uid()
                  )
            )
        )
    );


-- ---------------------------------------------------------------------------
-- addresses: SPLIT into read + write policies.
--   READ: any user with a user_address_access entry (incl. staff) — needed
--         so the cashier app can render their assigned branches.
--   WRITE (INSERT/UPDATE/DELETE): managers/admins only, tenancy-checked.
--
-- The split is required because FOR ALL with a tightened USING would also
-- block staff SELECT, breaking the /addresses page.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "managers_own_addresses" ON addresses;
DROP POLICY IF EXISTS "addresses_read" ON addresses;
DROP POLICY IF EXISTS "addresses_write" ON addresses;

CREATE POLICY "addresses_read" ON addresses
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR id IN (
            SELECT address_id FROM public.user_address_access
            WHERE auth_id = auth.uid()
        )
    );

CREATE POLICY "addresses_write" ON addresses
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND id IN (
                SELECT address_id FROM public.user_address_access
                WHERE auth_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND manager_id IN (
                SELECT COALESCE(u.manager_id, u.id)
                FROM public.users u
                WHERE u.auth_id = auth.uid()
            )
        )
    );


-- ---------------------------------------------------------------------------
-- invite_tokens: only managers/admins can create or modify invites.
-- Anyone can still validate (read) a token for the signup flow.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "invite_write" ON invite_tokens;
CREATE POLICY "invite_write" ON invite_tokens
    FOR ALL
    USING (public.is_manager_auth(auth.uid()))
    WITH CHECK (public.is_manager_auth(auth.uid()));


-- ---------------------------------------------------------------------------
-- Sanity: read policies are unchanged (still permissive). Staff still
-- needs to read products/recipes/extras to render the POS menu.
-- =============================================
