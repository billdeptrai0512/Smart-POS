-- ============================================================
-- Monetization Phase 1 — Core Schema
-- Bước 1: app_config (server-side kill switch)
-- Bước 2: trial_grants, address_subscriptions, payment_intents
-- Bước 3: RPC get_address_entitlement
--
-- IDEMPOTENT: an toàn chạy nhiều lần (IF NOT EXISTS + DROP POLICY IF EXISTS)
-- Production-safe: chỉ tạo mới, không xóa/sửa bảng hiện tại
-- ============================================================

-- ── 1. Global kill switch ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Mặc định OFF: không charge ai trong suốt quá trình build + test
-- ON CONFLICT DO NOTHING → idempotent, không ghi đè nếu đã bật
INSERT INTO app_config (key, value)
VALUES ('monetization_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ── 2a. Trial grants ──────────────────────────────────────────────────────────
-- 1 phone (E.164) = 1 trial lifetime
-- Phase 1: phone column tạm thời có thể chứa user_id (uuid::text)
-- Phase 2 (Phone OTP): sẽ là số điện thoại E.164 thực
CREATE TABLE IF NOT EXISTS trial_grants (
    phone        TEXT PRIMARY KEY,
    address_id   UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    granted_at   TIMESTAMPTZ DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL
);

-- ── 2b. Address subscriptions ──────────────────────────────────────────────────
-- Mỗi record = 1 lần thanh toán hoặc 1 khoảng hiệu lực (trial/manual/paid)
-- payment_intent_id là FK → payment_intents, thêm sau khi bảng đó tồn tại
CREATE TABLE IF NOT EXISTS address_subscriptions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id        UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    tier              TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
    valid_from        DATE NOT NULL,
    valid_to          DATE NOT NULL,
    months            INT  NOT NULL DEFAULT 1 CHECK (months >= 1),
    amount_paid       INT  NOT NULL DEFAULT 0,
    payment_intent_id UUID,           -- FK constraint added below after payment_intents
    note              TEXT,           -- 'trial', 'admin_override', 'paid'
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addr_sub_lookup
    ON address_subscriptions (address_id, valid_to DESC);

-- ── 2c. Payment intents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_intents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id   UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    tier         TEXT NOT NULL CHECK (tier IN ('basic', 'pro')),
    months       INT  NOT NULL CHECK (months >= 1),
    amount       INT  NOT NULL,
    reference    TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'paid', 'expired', 'cancelled', 'manual_review')),
    expires_at   TIMESTAMPTZ NOT NULL,
    paid_at      TIMESTAMPTZ,
    sepay_tx_id  TEXT UNIQUE,         -- UNIQUE = idempotent webhook (no double-credit)
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intent_ref
    ON payment_intents (reference)
    WHERE status = 'pending';

-- Thêm FK constraint từ address_subscriptions → payment_intents
-- Chỉ thêm nếu chưa có (DO $$ để bỏ qua lỗi duplicate constraint)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'address_subscriptions'
          AND constraint_name = 'address_subscriptions_payment_intent_id_fkey'
    ) THEN
        ALTER TABLE address_subscriptions
            ADD CONSTRAINT address_subscriptions_payment_intent_id_fkey
            FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id);
    END IF;
END $$;

-- ── 3. Entitlement RPC ────────────────────────────────────────────────────────
-- Trả về tier + valid_to của sub active nhất
-- NULL row nếu không có sub nào còn hạn → app rớt về tier=null
-- SECURITY INVOKER: RLS áp dụng, user chỉ query được address của mình
CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT tier, MAX(valid_to) as valid_to
    FROM address_subscriptions
    WHERE address_id = p_address_id
      AND valid_from <= CURRENT_DATE
      AND valid_to   >= CURRENT_DATE
    GROUP BY tier;
$$;

-- ── 4. Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE address_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_grants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config             ENABLE ROW LEVEL SECURITY;

-- Xóa policy cũ trước khi tạo lại → idempotent khi chạy lại migration
DROP POLICY IF EXISTS "app_config_read"        ON app_config;
DROP POLICY IF EXISTS "addr_sub_select"        ON address_subscriptions;
DROP POLICY IF EXISTS "payment_intent_select"  ON payment_intents;
DROP POLICY IF EXISTS "trial_grants_no_direct" ON trial_grants;

-- app_config: tất cả authenticated users đọc được (frontend check kill switch)
CREATE POLICY "app_config_read" ON app_config
    FOR SELECT TO authenticated USING (true);

-- address_subscriptions: đúng pattern của project (users table + auth_id)
-- Manager thấy sub của address mình; staff thấy qua manager; admin thấy tất cả
CREATE POLICY "addr_sub_select" ON address_subscriptions
    FOR SELECT TO authenticated
    USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid()           -- manager trực tiếp
               OR u.id IN (
                   SELECT manager_id FROM users
                   WHERE auth_id = auth.uid() AND role IN ('staff', 'co-manager')
               )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

-- payment_intents: cùng pattern
CREATE POLICY "payment_intent_select" ON payment_intents
    FOR SELECT TO authenticated
    USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = auth.uid()
               OR u.id IN (
                   SELECT manager_id FROM users
                   WHERE auth_id = auth.uid() AND role IN ('staff', 'co-manager')
               )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    );

-- trial_grants: không expose trực tiếp (chỉ RPC server-side mới đọc)
CREATE POLICY "trial_grants_no_direct" ON trial_grants
    FOR SELECT TO authenticated USING (false);
