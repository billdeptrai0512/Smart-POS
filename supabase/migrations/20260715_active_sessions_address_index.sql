-- ==============================================================================================
-- 20260715_active_sessions_address_index.sql
-- active_sessions has no index on address_id — countActiveSessions (POSContext's orders-realtime
-- gate, authService.js) and fetchActiveSessions (address-select "ai đang online") both filter by
-- address_id + last_seen, so every call is a full sequential scan of the whole table today. Table
-- size scales with total staff users (UNIQUE(user_id), rows aren't deleted on tab-close), so at
-- thousands of addresses this is thousands of rows scanned per query.
--
-- Just made materially worse: the orders-realtime gate check was hardened today from a 5-minute
-- heartbeat to 30s (to close the "counter staff opened before order-taker" gap), a straight 10x
-- increase in call frequency against this same unindexed scan. Add the composite index the actual
-- WHERE clause needs before that cadence change ships at scale.
-- ==============================================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_active_sessions_address_last_seen
  ON active_sessions (address_id, last_seen);

COMMIT;
