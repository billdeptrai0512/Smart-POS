-- ============================================================
-- Monetization — Rework sang 3 module độc lập (Phase 1b · 2026-06-03)
-- tier basic/pro  →  cashflow / inventory / finance
--   cashflow  : view Dòng tiền
--   inventory : view Tồn kho (gồm hao hụt / Loss Audit — gộp 'pro' cũ vào đây)
--   finance   : view Báo cáo (P&L)
--
-- Cột vẫn tên `tier` nhưng nay lưu giá trị MODULE (giữ tên để khỏi đụng FK/index/hook).
-- Xem docs/MONETIZATION.md §1, §4, §10 (R2).
--
-- ⚠️ PROD + DEV DÙNG CHUNG 1 DATABASE — migration phải:
--   • Sửa trigger grant_trial_on_address_creation (đang INSERT basic/pro) TRƯỚC khi
--     đổi CHECK, nếu không việc tạo địa chỉ mới sẽ vỡ.
--   • KHÔNG đụng get_address_entitlement (đã được hardening search_path ở 20260520).
--
-- IDEMPOTENT (chạy lại an toàn) + chạy trong 1 transaction (Supabase SQL editor).
-- ============================================================

-- ── 1. Sửa trigger trial: cấp 3 module thay vì basic/pro ───────────────────────
-- Redefine TRƯỚC khi đổi CHECK để mọi INSERT mới (kể cả concurrent) dùng module mới.
-- Trial = full 3 module trong 3 ngày (xem MONETIZATION.md §1 Trial).
CREATE OR REPLACE FUNCTION grant_trial_on_address_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public      -- hardening cho SECURITY DEFINER (advisor-safe)
AS $$
DECLARE
    v_address_count INT;
BEGIN
    SELECT COUNT(*) INTO v_address_count
    FROM addresses
    WHERE manager_id = NEW.manager_id;

    -- AFTER INSERT: địa chỉ hiện tại đã có trong bảng → count=1 nghĩa là địa chỉ đầu tiên.
    IF v_address_count = 1 THEN
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES
            (NEW.id, 'cashflow',  CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial'),
            (NEW.id, 'inventory', CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial'),
            (NEW.id, 'finance',   CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial');
    END IF;

    RETURN NEW;
END;
$$;
-- Trigger trg_grant_trial_on_address_creation đã trỏ tới function này (20260512) — không cần tạo lại.

-- ── 2. Gỡ CHECK cũ (basic/pro) — drop theo tên mặc định của inline column-check ──
-- Postgres đặt tên inline CHECK là <table>_<column>_check → idempotent qua IF EXISTS.
ALTER TABLE address_subscriptions DROP CONSTRAINT IF EXISTS address_subscriptions_tier_check;
ALTER TABLE payment_intents       DROP CONSTRAINT IF EXISTS payment_intents_tier_check;

-- ── 3. Convert dữ liệu legacy (nếu có row basic/pro do trigger trial đã chạy) ───
-- 'pro' (Loss Audit) → 'inventory'
UPDATE address_subscriptions SET tier = 'inventory' WHERE tier = 'pro';
UPDATE payment_intents       SET tier = 'inventory' WHERE tier = 'pro';

-- 'basic' (mở toàn bộ báo cáo) → faithful: tách thành cashflow + finance (+ chính nó → inventory).
-- Pre-launch flag OFF nên các row này là trial đã/đang hết hạn, convert chỉ để hợp lệ CHECK.
INSERT INTO address_subscriptions
    (address_id, tier, valid_from, valid_to, months, amount_paid, payment_intent_id, note)
SELECT address_id, m.module, valid_from, valid_to, months, amount_paid, payment_intent_id,
       COALESCE(note, '') || ' (split from basic)'
FROM address_subscriptions
CROSS JOIN (VALUES ('cashflow'), ('finance')) AS m(module)
WHERE tier = 'basic';

UPDATE address_subscriptions SET tier = 'inventory' WHERE tier = 'basic';
UPDATE payment_intents       SET tier = 'inventory' WHERE tier = 'basic';

-- ── 4. Thêm CHECK mới (3 module) — cùng tên cũ để giữ chuẩn đặt tên ─────────────
ALTER TABLE address_subscriptions
    ADD CONSTRAINT address_subscriptions_tier_check
    CHECK (tier IN ('cashflow', 'inventory', 'finance'));

ALTER TABLE payment_intents
    ADD CONSTRAINT payment_intents_tier_check
    CHECK (tier IN ('cashflow', 'inventory', 'finance'));

-- get_address_entitlement: KHÔNG đụng. Body không đổi (GROUP BY tier vẫn đúng với
-- giá trị module), và đã có SET search_path=public từ migration 20260520 — recreate
-- ở đây sẽ làm mất hardening đó. activeModules ở frontend = mảng các `tier` trả về.
