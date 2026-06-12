-- ==============================================================================================
-- 20260612_perf_advisor_fixes.sql — dọn Performance Advisor
--
-- 1. [0003 auth_rls_initplan] 5 policy gọi auth.uid() TRẦN → Postgres re-evaluate cho TỪNG
--    dòng khi scan. Wrap thành (select auth.uid()) → chạy 1 lần/query (InitPlan).
--    Logic giữ NGUYÊN VĂN, chỉ wrap. Đáng kể nhất là expense_payments (report đọc mỗi ngày).
--
-- 2. [0006 multiple_permissive_policies] app_settings có 2 policy cùng áp cho SELECT
--    (app_settings_read FOR SELECT + app_settings_admin_write FOR ALL) → mỗi SELECT phải
--    chạy cả 2. Tách admin_write thành INSERT/UPDATE/DELETE riêng — SELECT chỉ còn 1 policy.
--    ⚠️ Giữ app_settings_read như cũ (không TO authenticated): guest mode đọc default sort
--    bằng role anon TRƯỚC khi đăng nhập.
--
-- 3. [0001 unindexed_foreign_keys] 3 index FK cho bảng monetization (nhẹ, dùng khi JOIN
--    + khi DELETE cascade).
--
-- 4. [0005 unused_index] KHÔNG xoá — quyết định chủ đích: các bảng còn nhỏ nên planner
--    seq-scan (index "chưa được dùng" ≠ vô dụng); dữ liệu lớn lên thì chính các index
--    address_id này mới phát huy. Chi phí giữ ≈ 0 ở quy mô POS.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

-- ── 1a. address_subscriptions.addr_sub_select ─────────────────────────────────
DROP POLICY IF EXISTS "addr_sub_select" ON address_subscriptions;
CREATE POLICY "addr_sub_select" ON address_subscriptions
    FOR SELECT TO authenticated
    USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = (select auth.uid())           -- manager trực tiếp
               OR u.id IN (
                   SELECT manager_id FROM users
                   WHERE auth_id = (select auth.uid()) AND role IN ('staff', 'co-manager')
               )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    );

-- ── 1b. payment_intents.payment_intent_select ─────────────────────────────────
DROP POLICY IF EXISTS "payment_intent_select" ON payment_intents;
CREATE POLICY "payment_intent_select" ON payment_intents
    FOR SELECT TO authenticated
    USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = (select auth.uid())
               OR u.id IN (
                   SELECT manager_id FROM users
                   WHERE auth_id = (select auth.uid()) AND role IN ('staff', 'co-manager')
               )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    );

-- ── 1c. expense_categories.managers_expense_categories ────────────────────────
DROP POLICY IF EXISTS "managers_expense_categories" ON expense_categories;
CREATE POLICY "managers_expense_categories" ON expense_categories
    FOR ALL USING (
        public.is_admin_auth((select auth.uid()))
        OR address_id IN (
            SELECT address_id FROM user_address_access WHERE auth_id = (select auth.uid())
        )
    );

-- ── 1d. expense_payments.managers_expense_payments ────────────────────────────
DROP POLICY IF EXISTS "managers_expense_payments" ON expense_payments;
CREATE POLICY "managers_expense_payments" ON expense_payments
    FOR ALL USING (
        address_id IN (
            SELECT a.id FROM addresses a
            JOIN users u ON u.id = a.manager_id
            WHERE u.auth_id = (select auth.uid()) OR u.id IN (
                SELECT manager_id FROM users WHERE auth_id = (select auth.uid()) AND role = 'staff'
            )
        )
        OR EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    );

-- ── 2. app_settings: tách FOR ALL khỏi SELECT (hết overlap) + initplan ─────────
-- app_settings_read (FOR SELECT USING true) GIỮ NGUYÊN — anon/guest cần đọc.
DROP POLICY IF EXISTS "app_settings_admin_write" ON app_settings;

DROP POLICY IF EXISTS "app_settings_admin_insert" ON app_settings;
CREATE POLICY "app_settings_admin_insert" ON app_settings
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    );

DROP POLICY IF EXISTS "app_settings_admin_update" ON app_settings;
CREATE POLICY "app_settings_admin_update" ON app_settings
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    );

DROP POLICY IF EXISTS "app_settings_admin_delete" ON app_settings;
CREATE POLICY "app_settings_admin_delete" ON app_settings
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM users WHERE auth_id = (select auth.uid()) AND role = 'admin')
    );

-- ── 3. Index cho FK chưa có index ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_addr_sub_payment_intent_id
    ON address_subscriptions(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_intents_address_id
    ON payment_intents(address_id);
CREATE INDEX IF NOT EXISTS idx_trial_grants_address_id
    ON trial_grants(address_id);

COMMIT;
