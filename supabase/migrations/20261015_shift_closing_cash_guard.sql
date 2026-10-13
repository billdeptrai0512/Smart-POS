-- ==============================================================================================
-- Sửa Thực thu (actual_cash / actual_transfer) của ngày đã qua: CHỈ quản lý.
--
-- App chỉ ẩn ô nhập với nhân viên; RLS `managers_shift_closings` là FOR ALL theo user_address_access
-- nên nhân viên vẫn UPDATE được phiếu cũ nếu gọi API trực tiếp. Trigger này chặn ở DB: nhân viên
-- (users.role = 'staff') không được
--   • đổi tiền mặt / chuyển khoản của phiếu thuộc ngày VN đã qua,
--   • dời closed_at từ/sang ngày đã qua (dời phiếu hôm nay về quá khứ = tự tạo số liệu cho ngày cũ),
--   • INSERT phiếu mang ngày đã qua.
--
-- auth.uid() IS NULL (SQL editor, service role, job) → bỏ qua, giống ownership guard của các hàm khác.
-- Trigger KHÔNG gọi được từ /rest/v1/rpc: revoke hết EXECUTE (xem CLAUDE.md → hàm nội bộ).
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.shift_closing_cash_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL
       OR NOT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'staff') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF vn_business_date(NEW.closed_at) < vn_business_date(now()) THEN
            RAISE EXCEPTION 'Chỉ quản lý được tạo phiếu chốt cho ngày đã qua' USING ERRCODE = '42501';
        END IF;
    ELSIF (NEW.actual_cash IS DISTINCT FROM OLD.actual_cash
           OR NEW.actual_transfer IS DISTINCT FROM OLD.actual_transfer
           OR NEW.closed_at IS DISTINCT FROM OLD.closed_at)
          AND (vn_business_date(OLD.closed_at) < vn_business_date(now())
               OR vn_business_date(NEW.closed_at) < vn_business_date(now())) THEN
        RAISE EXCEPTION 'Chỉ quản lý được sửa thực thu của ngày đã qua' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.shift_closing_cash_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shift_closing_cash_guard ON public.shift_closings;
CREATE TRIGGER trg_shift_closing_cash_guard
    BEFORE INSERT OR UPDATE ON public.shift_closings
    FOR EACH ROW EXECUTE FUNCTION public.shift_closing_cash_guard();
