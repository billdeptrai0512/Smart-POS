-- =============================================
-- RLS denormalization — STEP 1 of 2: Setup (additive, no RLS change yet)
-- =============================================
-- This step is SAFE to run anytime: it only adds a new table, indexes, helper
-- function, triggers, and a one-time backfill. No existing policy changes,
-- no existing data is modified. Application behavior is unchanged.
--
-- After this step finishes, run `20260501_rls_denorm_verify.sql` and confirm
-- it reports 0 diff rows. Only then proceed to step 2.
--
-- =============================================
-- 1. Flat access table
-- =============================================
-- One row per (user, address) the user can read. Replaces the triple-nested
-- subquery used by the current RLS policies on orders/expenses/etc.
--
-- Admin role is NOT materialized here (would be |admins| × |addresses| rows
-- and admins change rarely). Admin checks live in is_admin_auth() below.

CREATE TABLE IF NOT EXISTS user_address_access (
    auth_id UUID NOT NULL,
    address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    PRIMARY KEY (auth_id, address_id)
);

CREATE INDEX IF NOT EXISTS idx_uaa_auth_id ON user_address_access(auth_id);
CREATE INDEX IF NOT EXISTS idx_uaa_address_id ON user_address_access(address_id);

-- =============================================
-- 2. Helper functions used by the new RLS policies
-- =============================================

-- Cheap admin lookup. STABLE = Postgres can memoize within a query.
CREATE OR REPLACE FUNCTION public.is_admin_auth(p_auth_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users WHERE auth_id = p_auth_id AND role = 'admin'
    );
$$;

-- "Owner manager" of a user — the manager whose addresses this user can see.
-- Returns u.manager_id if set (staff or co-manager), else u.id (main manager).
CREATE OR REPLACE FUNCTION public.user_owner_id(p_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT COALESCE(manager_id, id) FROM users WHERE id = p_user_id;
$$;

-- =============================================
-- 3. Triggers to keep user_address_access in sync
-- =============================================
-- The flat table is rebuilt by triggers on `users` and `addresses`. Triggers
-- run AFTER each statement so they see the committed row state.

-- ---- (a) When an address is created/updated/deleted ----
-- SECURITY DEFINER: client roles cannot write to user_address_access (we
-- revoked it below). The trigger must run with the function-owner's
-- privileges so it can INSERT/DELETE on the flat table.
-- search_path is locked to defeat hijacking via temp schemas.
CREATE OR REPLACE FUNCTION uaa_on_address_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- ON DELETE CASCADE on the FK already removes rows; nothing to do
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.manager_id IS NOT DISTINCT FROM OLD.manager_id THEN
        RETURN NEW;  -- no membership change
    END IF;

    -- For INSERT, or when manager_id changed: rebuild rows for this address
    DELETE FROM user_address_access WHERE address_id = NEW.id;

    INSERT INTO user_address_access (auth_id, address_id)
    SELECT u.auth_id, NEW.id
    FROM users u
    WHERE u.auth_id IS NOT NULL
      AND u.role <> 'admin'
      AND COALESCE(u.manager_id, u.id) = NEW.manager_id
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uaa_on_address_change ON addresses;
CREATE TRIGGER trg_uaa_on_address_change
    AFTER INSERT OR UPDATE OR DELETE ON addresses
    FOR EACH ROW EXECUTE FUNCTION uaa_on_address_change();

-- ---- (b) When a user is created/updated/deleted ----
-- SECURITY DEFINER for the same reason as the address-change trigger.
CREATE OR REPLACE FUNCTION uaa_on_user_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    old_owner UUID;
    new_owner UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM user_address_access WHERE auth_id = OLD.auth_id;
        RETURN OLD;
    END IF;

    -- Resolve the addresses-owner (manager whose addresses this user sees)
    new_owner := COALESCE(NEW.manager_id, NEW.id);
    old_owner := CASE
        WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.manager_id, OLD.id)
        ELSE NULL
    END;

    -- Skip work when nothing relevant changed
    IF TG_OP = 'UPDATE'
       AND NEW.auth_id IS NOT DISTINCT FROM OLD.auth_id
       AND NEW.role IS NOT DISTINCT FROM OLD.role
       AND new_owner IS NOT DISTINCT FROM old_owner THEN
        RETURN NEW;
    END IF;

    -- Always wipe and re-add for this user's auth_id (idempotent)
    IF NEW.auth_id IS NOT NULL THEN
        DELETE FROM user_address_access WHERE auth_id = NEW.auth_id;

        IF NEW.role <> 'admin' THEN
            INSERT INTO user_address_access (auth_id, address_id)
            SELECT NEW.auth_id, a.id
            FROM addresses a
            WHERE a.manager_id = new_owner
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    -- If auth_id changed, also clean up the old auth_id's rows
    IF TG_OP = 'UPDATE' AND OLD.auth_id IS NOT NULL
       AND NEW.auth_id IS DISTINCT FROM OLD.auth_id THEN
        DELETE FROM user_address_access WHERE auth_id = OLD.auth_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_uaa_on_user_change ON users;
CREATE TRIGGER trg_uaa_on_user_change
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION uaa_on_user_change();

-- =============================================
-- 4. One-time backfill from existing data
-- =============================================
-- Mirrors what the triggers will do going forward.

INSERT INTO user_address_access (auth_id, address_id)
SELECT u.auth_id, a.id
FROM users u
JOIN addresses a ON a.manager_id = COALESCE(u.manager_id, u.id)
WHERE u.auth_id IS NOT NULL
  AND u.role <> 'admin'
ON CONFLICT DO NOTHING;

-- =============================================
-- 5. Permissions
-- =============================================
-- The flat table is read by RLS policies (which run as the calling role) and
-- written only by triggers (which run as the table-owner via SECURITY INVOKER
-- on the trigger function — the trigger inherits owner privileges by default
-- in Postgres). Authenticated clients should NOT manipulate this table.

REVOKE ALL ON user_address_access FROM authenticated, anon;
GRANT SELECT ON user_address_access TO authenticated;

ALTER TABLE user_address_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "uaa_self_read" ON user_address_access;
CREATE POLICY "uaa_self_read" ON user_address_access
    FOR SELECT USING (auth_id = auth.uid());

GRANT EXECUTE ON FUNCTION public.is_admin_auth(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owner_id(UUID) TO authenticated;
