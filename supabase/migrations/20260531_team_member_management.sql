-- ==============================================================================================
-- 20260531_team_member_management.sql
-- Description: Let a manager manage their team from /addresses → Nhân sự tab:
--   promote staff → co-manager, demote co-manager → staff, and remove a member.
--
-- The `users` table has RLS enabled with only SELECT + INSERT policies, so the client cannot
-- change roles or delete members. Rather than open broad UPDATE/DELETE policies on `users`
-- (a policy on `users` that selects FROM `users` recurses), we expose two SECURITY DEFINER
-- RPCs guarded by the same ownership pattern used in 20260520_security_hardening.sql:
--   - caller must be a manager/admin (is_manager_auth)
--   - target must belong to the caller's team (target.manager_id = auth_owner_id(caller))
--   - role changes are limited to 'staff' ⇄ 'manager' (never touches 'admin')
-- The guard skips when auth.uid() IS NULL so service_role / migrations can call freely.
--
-- remove_team_member hard-deletes the profile row. active_sessions cascade automatically;
-- shift_closings.closed_by is set NULL first (it has no ON DELETE rule, so the FK would
-- otherwise block deletion of any member who has closed a shift). The auth.users login is
-- left orphaned — the app shows nothing to a profile-less user.
-- ==============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- set_team_member_role — promote (staff → manager) / demote (manager → staff)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_team_member_role(
    p_user_id UUID,
    p_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_role   TEXT;
    v_target_manager UUID;
BEGIN
    IF p_role NOT IN ('staff', 'manager') THEN
        RAISE EXCEPTION 'Invalid role %', p_role USING ERRCODE = 'check_violation';
    END IF;

    SELECT role, manager_id INTO v_current_role, v_target_manager
    FROM users WHERE id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'User % not found', p_user_id;
    END IF;

    -- Ownership guard. Skip when auth.uid() IS NULL (service_role / migrations bypass).
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can change team roles' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_target_manager IS DISTINCT FROM public.auth_owner_id(auth.uid()) THEN
            RAISE EXCEPTION 'User % is not on your team', p_user_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_current_role NOT IN ('staff', 'manager') THEN
            RAISE EXCEPTION 'Cannot change role of a % user', v_current_role USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    UPDATE users SET role = p_role WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_team_member_role(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_team_member_role(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_team_member_role(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- remove_team_member — hard-delete a team member's profile
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_team_member(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_role   TEXT;
    v_target_manager UUID;
BEGIN
    SELECT role, manager_id INTO v_current_role, v_target_manager
    FROM users WHERE id = p_user_id;

    IF v_current_role IS NULL THEN
        RETURN; -- already gone — idempotent
    END IF;

    -- Ownership guard. Skip when auth.uid() IS NULL (service_role / migrations bypass).
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_manager_auth(auth.uid()) THEN
            RAISE EXCEPTION 'Only managers can remove team members' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_target_manager IS DISTINCT FROM public.auth_owner_id(auth.uid()) THEN
            RAISE EXCEPTION 'User % is not on your team', p_user_id USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_current_role NOT IN ('staff', 'manager') THEN
            RAISE EXCEPTION 'Cannot remove a % user', v_current_role USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- Detach / reparent the two FK references that have no ON DELETE rule, so neither
    -- blocks the delete. active_sessions and invite_tokens cascade on their own.
    --   1. shift_closings.closed_by — null it so historical closings survive.
    --   2. users.manager_id (self-FK) — a co-manager may have personally invited staff
    --      (invite links carry the generator's id), so those staff point at this member.
    --      Reparent them to this member's own owner (the top manager) to keep them on the team.
    UPDATE shift_closings SET closed_by = NULL WHERE closed_by = p_user_id;
    UPDATE users SET manager_id = v_target_manager WHERE manager_id = p_user_id;
    DELETE FROM users WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_team_member(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_team_member(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.remove_team_member(UUID) TO authenticated;

COMMIT;
