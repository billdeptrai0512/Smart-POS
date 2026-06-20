-- ============================================================
-- Trial đếm ngược từ lần CHỐT CA đầu tiên, không phải từ ngày tạo địa chỉ — 2026-06-21
--
-- Vấn đề: trial cấp lúc tạo địa chỉ (valid_to = ngày tạo + 7). Khi chủ quán
-- mất vài ngày setup/sao lưu cấu hình trước khi bán thật → trial cháy oan trong
-- lúc chưa dùng. Đặc biệt rõ ở luồng backup (tạo địa chỉ mới rồi clone config).
--
-- Cách xử lý (bản lười, KHÔNG đổi schema):
--   Vẫn cấp trial lúc tạo (để có quyền xem báo cáo ngay khi setup), NHƯNG lần
--   chốt ca ĐẦU TIÊN của địa chỉ sẽ "neo lại" trial = ngày chốt + 7. Vì ngày
--   chốt >= ngày tạo, valid_to chỉ có thể GIỮ NGUYÊN hoặc DÀI RA, không bao giờ
--   ngắn lại → không phạt ai. Không chốt ca lần nào → trial hết bình thường ở
--   ngày tạo + 7 (không lạm dụng được).
--
-- "Lần đầu" = đếm shift_closings của địa chỉ == 1 (row vừa INSERT đã nằm trong
-- bảng khi AFTER INSERT chạy). Chỉ động vào row note='trial' (bỏ qua 'paid').
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

CREATE OR REPLACE FUNCTION reanchor_trial_on_first_shift_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Chỉ neo lại ở lần chốt ca đầu tiên của địa chỉ.
    IF (SELECT COUNT(*) FROM shift_closings WHERE address_id = NEW.address_id) = 1 THEN
        -- GREATEST: chỉ kéo DÀI, không bao giờ rút ngắn (phòng trial đã được gia
        -- hạn tay xa hơn ngày_chốt + 7).
        UPDATE address_subscriptions
        SET valid_to = GREATEST(valid_to, vn_business_date(NEW.closed_at) + 7)
        WHERE address_id = NEW.address_id
          AND note = 'trial';
    END IF;
    RETURN NEW;
END;
$$;

-- Hàm trigger: revoke EXECUTE khỏi mọi role (trigger tự chạy trong ngữ cảnh câu
-- lệnh, không cần cấp EXECUTE) — chống regression Security Advisor.
REVOKE EXECUTE ON FUNCTION public.reanchor_trial_on_first_shift_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reanchor_trial_on_first_shift_close ON shift_closings;
CREATE TRIGGER trg_reanchor_trial_on_first_shift_close
AFTER INSERT ON shift_closings
FOR EACH ROW
EXECUTE FUNCTION reanchor_trial_on_first_shift_close();
