-- =============================================
-- Drop dead invite_tokens table
-- =============================================
-- invite_tokens backed an invite-link staff onboarding flow that's fully
-- superseded by the direct create-team-member Edge Function (PIN-based).
-- Confirmed dead: no route/component reads it, no code (frontend or edge
-- function) ever INSERTs a row, and used_at is never written by anything —
-- tokens were never even being marked used. `authService.validateInviteToken`
-- is unreferenced dead code, removed alongside this in the same change.
--
-- Also closes an open finding from the 2026-07-11 RLS sweep: invite_write
-- let any manager account (including a different tenant's) modify/delete
-- another tenant's invite tokens (`is_manager_auth()` with no ownership
-- scoping). Simplest fix for a table nobody uses: remove it.
--
-- No other table has a FK to invite_tokens (checked). Safe to run once;
-- IF EXISTS makes repeat runs a no-op.

DROP TABLE IF EXISTS invite_tokens;
