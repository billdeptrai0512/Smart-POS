-- ============================================================
-- Bỏ điều kiện "phải có SĐT" khi cấp trial + trial 7 → 14 ngày — 2026-08-02
--
-- SignUpPage đổi field SĐT → Email (email là đường reset mật khẩu), nên tài
-- khoản mới không còn chắc chắn có `users.phone` lúc chốt ca full đầu tiên.
-- Điều kiện phone trong trigger vốn CHỈ còn là "mồi UX" từ thời trial bind theo
-- SĐT — 20260717_trial_4_per_address_not_per_phone.sql đã bỏ hẳn vai trò
-- anti-abuse của nó. Giữ lại nữa = mọi signup mới im lặng mất trial.
--
-- Thay đổi so với bản 20260717_trial_4:
--   1. Bỏ khối SELECT u.phone + early-return khi NULL. Vẫn ghi trial_grants
--      (phone có thì ghi, NULL thì thôi) cho dữ liệu lịch sử.
--   2. Trial 7 → 14 ngày (chốt 2026-08-02). Chỉ áp cho lần cấp/reanchor SAU khi
--      apply — các sub 'trial' đã cấp trước đó vẫn giữ mốc 7 ngày cũ.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

CREATE OR REPLACE FUNCTION grant_trial_on_first_full_shift_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_missing    INT;
    v_phone      TEXT;
    v_close_date DATE;
BEGIN
    IF NEW.cash_closed_at IS NULL THEN
        RETURN NEW;  -- chưa lưu thực thu → chắc chắn chưa full
    END IF;

    -- Chỉ tính nguyên liệu count_in_audit != false (khớp UI, xem
    -- useShiftInventoryState.js) — nguyên liệu tắt "kiểm kê hao hụt" UI không
    -- hiển thị để nhập, không thể bắt phải đếm.
    SELECT COUNT(*) INTO v_missing
    FROM (
        SELECT DISTINCT ingredient FROM ingredient_costs
        WHERE address_id = NEW.address_id AND count_in_audit IS DISTINCT FROM false
    ) ic
    WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.inventory_report, '[]'::jsonb)) elem
        WHERE (elem->>'ingredient') = ic.ingredient
          AND elem->>'remaining' IS NOT NULL
    );
    IF v_missing > 0 THEN
        RETURN NEW;  -- kiểm kho chưa đủ → chưa full
    END IF;

    v_close_date := vn_business_date(NEW.closed_at);

    -- Data cũ: địa chỉ đã có sub (trial cấp lúc tạo theo cơ chế trước
    -- 2026-07-17, hoặc đã paid) → chỉ reanchor 1 lần, không tạo thêm.
    IF EXISTS (SELECT 1 FROM address_subscriptions WHERE address_id = NEW.address_id) THEN
        UPDATE address_subscriptions
           SET valid_to = GREATEST(valid_to, v_close_date + 14),
               trial_reanchored_at = COALESCE(trial_reanchored_at, now())
         WHERE address_id = NEW.address_id
           AND note = 'trial'
           AND trial_reanchored_at IS NULL;
        RETURN NEW;
    END IF;

    -- Địa chỉ CHƯA từng có sub nào — ca full này chính là mốc trial bắt đầu.
    -- KHÔNG còn điều kiện nào về SĐT (xem đầu file).
    INSERT INTO address_subscriptions
        (address_id, tier, valid_from, valid_to, amount_paid, note, trial_reanchored_at)
    VALUES
        (NEW.address_id, 'all', v_close_date, v_close_date + 14, 0, 'trial', now());

    -- Ghi trial_grants cho mục đích lịch sử/tham khảo (KHÔNG dùng để gate) —
    -- chỉ ghi được khi owner có SĐT; PK là phone nên NULL phải bỏ qua.
    SELECT u.phone INTO v_phone
    FROM addresses a JOIN users u ON u.id = a.manager_id
    WHERE a.id = NEW.address_id;

    IF v_phone IS NOT NULL THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, NEW.address_id, (v_close_date + 14)::timestamptz)
        ON CONFLICT (phone) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_trial_on_first_full_shift_close() FROM PUBLIC, anon, authenticated;
