-- Tự động cấp trial 3 ngày cho gói 'basic' và 'pro' khi tạo địa chỉ đầu tiên.
-- Bỏ qua kiểm tra phone, chỉ đếm số lượng address của manager.

CREATE OR REPLACE FUNCTION grant_trial_on_address_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- Cần quyền để đọc addresses khác của manager
AS $$
DECLARE
    v_address_count INT;
BEGIN
    -- Kiểm tra xem đây có phải địa chỉ đầu tiên của manager này không
    SELECT COUNT(*) INTO v_address_count 
    FROM addresses 
    WHERE manager_id = NEW.manager_id;
    
    -- Khi AFTER INSERT chạy, địa chỉ hiện tại đã nằm trong bảng.
    -- Nên nếu count = 1, đây là địa chỉ đầu tiên.
    IF v_address_count = 1 THEN
        -- Cấp 3 ngày trial cho gói basic
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES (NEW.id, 'basic', CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial');

        -- Cấp 3 ngày trial cho gói pro
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES (NEW.id, 'pro', CURRENT_DATE, CURRENT_DATE + 3, 0, 'trial');
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_trial_on_address_creation ON addresses;
CREATE TRIGGER trg_grant_trial_on_address_creation
AFTER INSERT ON addresses
FOR EACH ROW
EXECUTE FUNCTION grant_trial_on_address_creation();
