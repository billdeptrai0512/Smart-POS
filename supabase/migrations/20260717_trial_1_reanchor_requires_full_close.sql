-- ============================================================
-- Neo lại trial chỉ khi ca chốt "FULL" (thực thu + kiểm kho đủ) — 2026-07-17
--
-- Vấn đề: trigger cũ (20260621) neo lại trial ở lần chốt ca ĐẦU TIÊN bất kỳ
-- (COUNT(*)=1), không quan tâm ca đó có nhập thực thu / kiểm kho hay không. Ca
-- đầu tiên chỉ bấm thử (chưa lưu thực thu, chưa đếm nguyên liệu nào) vẫn dùng
-- mất cơ hội neo-1-lần → ca chốt thật sau đó không được neo lại nữa.
--
-- Fix: đổi điều kiện neo thành "lần chốt ca FULL đầu tiên":
--   • Full = đã bấm "Lưu thực thu" (cash_closed_at IS NOT NULL) VÀ inventory_report
--     phủ đủ mọi nguyên liệu active của địa chỉ (ingredient_costs). Địa chỉ chưa
--     cấu hình nguyên liệu nào → vacuously đủ (không có gì để thiếu).
--   • "Đầu tiên" = cột trial_reanchored_at (mới, trên address_subscriptions) còn
--     NULL — set 1 lần duy nhất, KHÔNG dùng lại COUNT(*) lịch sử (rẻ + chính xác,
--     không phải suy luận lại tính "full" của các ca cũ).
--
-- shift_closings là 1 row/địa chỉ/ngày, được UPDATE dần qua 2 action độc lập
-- (Lưu thực thu / Lưu kiểm kho) — nên trigger phải chạy cả AFTER UPDATE, không
-- chỉ AFTER INSERT như bản cũ.
--
-- ⚠️ SUPERSEDED: function/trigger trong file này bị 20260717_trial_deferred_
-- until_first_full_close.sql DROP + tạo lại (mô hình lớn hơn — trial không cấp
-- lúc tạo địa chỉ nữa, chỉ cấp ở ca full đầu tiên). Cột trial_reanchored_at ở
-- dưới vẫn là cột NỀN TẢNG được các migration sau tái sử dụng — KHÔNG xoá file
-- này / KHÔNG bỏ ALTER TABLE, dù phần function/trigger không còn hiệu lực cuối.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

ALTER TABLE address_subscriptions
    ADD COLUMN IF NOT EXISTS trial_reanchored_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION reanchor_trial_on_first_shift_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_missing INT;
BEGIN
    -- Chưa bấm "Lưu thực thu" → chắc chưa full (trigger WHEN đã lọc phần lớn,
    -- check lại đây cho chặt vì function có thể được gọi trực tiếp).
    IF NEW.cash_closed_at IS NULL THEN
        RETURN NEW;
    END IF;

    -- Đếm nguyên liệu active của địa chỉ CHƯA có remaining trong inventory_report
    -- của ca này. 0 nguyên liệu cấu hình → 0 thiếu (vacuously full). Chỉ tính
    -- count_in_audit != false — khớp đúng danh sách UI cho staff đếm (client lọc
    -- y hệt trong useShiftInventoryState.js) — nguyên liệu tắt "kiểm kê hao hụt"
    -- UI còn không hiển thị để nhập, không thể bắt phải đếm.
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

    -- Full — neo lại NHƯNG chỉ 1 lần (trial_reanchored_at IS NULL). Nếu đã neo
    -- rồi thì bỏ qua (không phải "rolling window" mỗi lần chốt ca).
    UPDATE address_subscriptions
       SET valid_to = GREATEST(valid_to, vn_business_date(NEW.closed_at) + 7),
           trial_reanchored_at = now()
     WHERE address_id = NEW.address_id
       AND note = 'trial'
       AND trial_reanchored_at IS NULL;

    RETURN NEW;
END;
$$;

-- Hàm trigger: revoke EXECUTE khỏi mọi role (chống regression Security Advisor).
REVOKE EXECUTE ON FUNCTION public.reanchor_trial_on_first_shift_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reanchor_trial_on_first_shift_close ON shift_closings;
CREATE TRIGGER trg_reanchor_trial_on_first_shift_close
AFTER INSERT OR UPDATE ON shift_closings
FOR EACH ROW
WHEN (NEW.cash_closed_at IS NOT NULL)
EXECUTE FUNCTION reanchor_trial_on_first_shift_close();
