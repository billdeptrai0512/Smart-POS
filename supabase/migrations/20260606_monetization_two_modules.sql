-- ============================================================
-- Monetization — gộp 3 module → 2 (Phase 1c · 2026-06-06)
-- Gộp "Báo cáo/Lợi nhuận" (finance) VÀO "Dòng tiền" (cashflow):
--   cashflow  : mở khoá CẢ view Dòng tiền LẪN view Lợi nhuận (P&L)
--   inventory : view Tồn kho (gồm hao hụt)
-- Chỉ còn 2 sản phẩm bán. Xem docs/MONETIZATION.md §1.
--
-- ⚠️ PROD + DEV CHUNG 1 DATABASE — sửa trigger trial TRƯỚC khi đổi CHECK.
-- IDEMPOTENT, chạy trong 1 transaction.
-- ============================================================

-- ── 1. Sửa trigger trial: cấp 2 module (cashflow + inventory) ──────────────────
CREATE OR REPLACE FUNCTION grant_trial_on_address_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_count INT;
BEGIN
    SELECT COUNT(*) INTO v_address_count
    FROM addresses
    WHERE manager_id = NEW.manager_id;

    IF v_address_count = 1 THEN
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES
            (NEW.id, 'cashflow',  CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial'),
            (NEW.id, 'inventory', CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial');
    END IF;

    RETURN NEW;
END;
$$;

-- ── 2. Gỡ CHECK 3-module (drop theo tên chuẩn) ─────────────────────────────────
ALTER TABLE address_subscriptions DROP CONSTRAINT IF EXISTS address_subscriptions_tier_check;
ALTER TABLE payment_intents       DROP CONSTRAINT IF EXISTS payment_intents_tier_check;

-- ── 3. Gộp dữ liệu: finance → cashflow ─────────────────────────────────────────
-- (Có thể tạo row cashflow trùng cho 1 address — vô hại, get_address_entitlement
--  GROUP BY tier nên gộp lại; không có unique trên (address_id, tier).)
UPDATE address_subscriptions SET tier = 'cashflow' WHERE tier = 'finance';
UPDATE payment_intents       SET tier = 'cashflow' WHERE tier = 'finance';

-- ── 4. CHECK mới: chỉ còn 2 module ─────────────────────────────────────────────
ALTER TABLE address_subscriptions
    ADD CONSTRAINT address_subscriptions_tier_check
    CHECK (tier IN ('cashflow', 'inventory'));

ALTER TABLE payment_intents
    ADD CONSTRAINT payment_intents_tier_check
    CHECK (tier IN ('cashflow', 'inventory'));

-- get_address_entitlement: KHÔNG đụng (vẫn GROUP BY tier, đúng với 2 giá trị).
