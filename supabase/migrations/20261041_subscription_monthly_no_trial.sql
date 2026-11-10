-- ============================================================
-- Mô hình mới: 88.888đ/tháng/địa chỉ, full tính năng, KHÔNG còn trial / free.
--   * Địa chỉ mới (0 row) → KHÓA (guest demo → đăng ký → paywall).
--   * Trial đang chạy → để hết hạn rồi khóa (không đụng row).
--   * Địa chỉ đang free vĩnh viễn (0 row) → ân hạn 7 ngày (row note='grace'), rồi khóa.
--
-- 1. Bỏ trigger cấp trial lúc full-close (kéo theo nhánh reanchor kéo dài trial cũ).
-- 2. get_address_entitlement: bỏ nhánh trả 'all' tới 2099 cho địa chỉ 0 row.
-- 3. Backfill ân hạn 7 ngày cho địa chỉ 0 row hiện có.
--
-- Giữ nguyên ownership guard + SET search_path (CLAUDE.md). Signature không đổi.
-- ⚠️ Apply migration TRƯỚC khi deploy client. IDEMPOTENT.
-- ============================================================

-- ── 1. Bỏ cấp trial ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_grant_trial_on_first_full_shift_close ON shift_closings;
DROP FUNCTION IF EXISTS public.grant_trial_on_first_full_shift_close();

-- ── 2. Backfill ân hạn: PHẢI chạy trước khi đổi RPC (không thì địa chỉ 0 row bị khóa ngay) ──
INSERT INTO address_subscriptions
    (address_id, tier, valid_from, valid_to, amount_paid, note)
SELECT a.id, 'all', CURRENT_DATE, CURRENT_DATE + 7, 0, 'grace'
FROM addresses a
WHERE a.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM address_subscriptions s WHERE s.address_id = a.id);

-- ── 3. get_address_entitlement: chỉ trả row còn hạn ──────────────────────────
CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- valid_to + 3: hết hạn vẫn dùng được thêm 3 ngày ("Bỏ qua" ở AddressSelectPage), sau đó khoá
    -- cứng. Phải khớp EXPIRED_GRACE_DAYS ở src/utils/subscriptionStatus.ts.
    RETURN QUERY
    SELECT s.tier, MAX(s.valid_to)
    FROM address_subscriptions s
    WHERE s.address_id = p_address_id
      AND s.valid_from <= CURRENT_DATE AND s.valid_to + 3 >= CURRENT_DATE
    GROUP BY s.tier;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_address_entitlement(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_address_entitlement(UUID) TO authenticated;
