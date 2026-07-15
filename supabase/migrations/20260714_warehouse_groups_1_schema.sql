-- ==============================================================================================
-- Kho tổng dùng chung nhiều địa chỉ (warehouse groups) — Phase 1: schema.
--
-- 1 manager có thể gộp 1 tập con địa chỉ của mình vào 1 "warehouse_groups" để chia sẻ chung
-- kho tổng (mua hàng ở địa chỉ nào trong nhóm cũng cộng vào cùng 1 pool, giá vốn hợp nhất).
-- Quầy (counter stock) của từng địa chỉ KHÔNG đổi — vẫn đếm tay riêng từng ca.
--
-- addresses.warehouse_group_id NULL = ngoài nhóm (mặc định cho mọi địa chỉ hiện có) → zero
-- backfill, hành vi cũ giữ nguyên 100%.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE addresses
    ADD COLUMN IF NOT EXISTS warehouse_group_id UUID REFERENCES warehouse_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_addresses_warehouse_group
    ON addresses(warehouse_group_id) WHERE warehouse_group_id IS NOT NULL;

ALTER TABLE warehouse_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_groups_select" ON warehouse_groups;
DROP POLICY IF EXISTS "warehouse_groups_insert" ON warehouse_groups;
DROP POLICY IF EXISTS "warehouse_groups_update" ON warehouse_groups;
DROP POLICY IF EXISTS "warehouse_groups_delete" ON warehouse_groups;

-- Mirror addresses' RLS pattern (20260503_fix_address_rls.sql).
CREATE POLICY "warehouse_groups_select" ON warehouse_groups
    FOR SELECT USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
        OR id IN (
            SELECT a.warehouse_group_id FROM addresses a
            WHERE a.warehouse_group_id IS NOT NULL
              AND a.id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
        )
    );

CREATE POLICY "warehouse_groups_insert" ON warehouse_groups
    FOR INSERT WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
    );

CREATE POLICY "warehouse_groups_update" ON warehouse_groups
    FOR UPDATE USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
    );

CREATE POLICY "warehouse_groups_delete" ON warehouse_groups
    FOR DELETE USING (
        public.is_admin_auth(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
    );

COMMIT;
