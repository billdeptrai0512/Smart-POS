-- =============================================
-- RLS denormalization — VERIFY (run between step 1 and step 2)
-- =============================================
-- Run each block as a separate query in the Supabase SQL editor and read the
-- result. All four blocks should return ZERO rows / matching counts before
-- you proceed to step 2.
--
-- If any block returns unexpected rows: STOP. Either fix the data (e.g. a
-- user with NULL auth_id that should have been linked, an orphan address)
-- or report back so we can adjust the migration.

-- -----------------------------------------------------------------------
-- Check 1 — flat table equals the INTENDED post-migration access set.
-- The intended set is: a non-admin user can see address X iff
--   COALESCE(u.manager_id, u.id) = addresses.manager_id
-- (covers main manager, staff, AND co-manager — the last is bypassed by the
-- current production RLS, which is a latent bug step 2 will fix.)
-- Expected: 0 rows
-- -----------------------------------------------------------------------
WITH expected_access AS (
    SELECT u.auth_id, a.id AS address_id
    FROM users u
    JOIN addresses a ON a.manager_id = COALESCE(u.manager_id, u.id)
    WHERE u.auth_id IS NOT NULL
      AND u.role <> 'admin'
),
new_access AS (
    SELECT auth_id, address_id FROM user_address_access
)
SELECT 'expected_not_in_new' AS diff, * FROM (
    SELECT auth_id, address_id FROM expected_access
    EXCEPT
    SELECT auth_id, address_id FROM new_access
) x
UNION ALL
SELECT 'new_not_expected', * FROM (
    SELECT auth_id, address_id FROM new_access
    EXCEPT
    SELECT auth_id, address_id FROM expected_access
) y;

-- -----------------------------------------------------------------------
-- Check 1b — list users who will GAIN access after step 2 vs current RLS.
-- These are users currently locked out by the latent co-manager bug. After
-- step 2 they will start seeing data their role implies they should see.
-- Review this list. If a row looks wrong (e.g. someone marked role='manager'
-- accidentally), fix the user record FIRST, before running step 2.
-- Expected: legitimate co-managers only, or 0 rows if you have none.
-- -----------------------------------------------------------------------
WITH current_rls_access AS (
    -- Mirror of the production RLS for orders/expenses/etc. exactly.
    SELECT u.auth_id, a.id AS address_id
    FROM addresses a
    JOIN users mgr ON mgr.id = a.manager_id
    JOIN users u ON (
        u.auth_id = mgr.auth_id  -- I am the address's main manager
        OR (u.role = 'staff' AND u.manager_id = mgr.id)  -- I am staff under them
    )
    WHERE u.auth_id IS NOT NULL
      AND u.role <> 'admin'
),
new_access AS (
    SELECT auth_id, address_id FROM user_address_access
),
gained AS (
    SELECT auth_id, address_id FROM new_access
    EXCEPT
    SELECT auth_id, address_id FROM current_rls_access
)
SELECT u.id AS user_id, u.name, u.role, u.manager_id, g.address_id, a.name AS address_name
FROM gained g
JOIN users u ON u.auth_id = g.auth_id
LEFT JOIN addresses a ON a.id = g.address_id
ORDER BY u.name, a.name;

-- -----------------------------------------------------------------------
-- Check 2 — every non-admin user with an auth_id has at least one row,
-- UNLESS their owner manager has zero addresses.
-- Expected: 0 rows
-- -----------------------------------------------------------------------
SELECT u.id, u.auth_id, u.role, COALESCE(u.manager_id, u.id) AS owner_id
FROM users u
WHERE u.auth_id IS NOT NULL
  AND u.role <> 'admin'
  AND NOT EXISTS (SELECT 1 FROM user_address_access WHERE auth_id = u.auth_id)
  AND EXISTS (SELECT 1 FROM addresses a WHERE a.manager_id = COALESCE(u.manager_id, u.id));

-- -----------------------------------------------------------------------
-- Check 3 — admins detected (sanity).
-- This should list every admin user. They are NOT in user_address_access
-- by design — RLS uses is_admin_auth() for them.
-- -----------------------------------------------------------------------
SELECT id, auth_id, name, role
FROM users
WHERE role = 'admin' AND auth_id IS NOT NULL;

-- -----------------------------------------------------------------------
-- Check 4 — counts summary.
-- Expected: total_rows == sum across users of (addresses they should see).
-- Just an eyeball check; no exact assertion.
-- -----------------------------------------------------------------------
SELECT
    (SELECT COUNT(*) FROM user_address_access)                                       AS total_rows,
    (SELECT COUNT(DISTINCT auth_id) FROM user_address_access)                        AS distinct_users,
    (SELECT COUNT(DISTINCT address_id) FROM user_address_access)                     AS distinct_addresses,
    (SELECT COUNT(*) FROM users WHERE auth_id IS NOT NULL AND role <> 'admin')       AS non_admin_linked_users,
    (SELECT COUNT(*) FROM addresses)                                                 AS total_addresses;
