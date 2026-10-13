-- ==============================================================================================
-- Sửa Thực thu của ngày đã qua: chỉ CHỦ quán (addresses.manager_id = users.id của người đang đăng nhập).
-- Thay bản "chỉ chặn nhân viên" của 20261015_shift_closing_cash_guard: đồng quản lý (users.manager_id
-- trỏ về chủ) và admin cũng bị chặn. Đủ để chạy một mình — tạo lại hàm + trigger (idempotent).
--
-- Người không phải chủ KHÔNG được:
--   • đổi tiền mặt / chuyển khoản của phiếu thuộc ngày VN đã qua,
--   • dời closed_at từ/sang ngày đã qua (dời phiếu hôm nay về quá khứ = tự tạo số liệu cho ngày cũ),
--   • INSERT phiếu mang ngày đã qua.
-- Phiếu hôm nay thì ai có quyền địa chỉ cũng sửa như cũ.
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
DECLARE
    v_address uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN v_address := NEW.address_id; ELSE v_address := OLD.address_id; END IF;

    IF EXISTS (SELECT 1 FROM addresses a JOIN users u ON u.id = a.manager_id
               WHERE a.id = v_address AND u.auth_id = auth.uid()) THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF vn_business_date(NEW.closed_at) < vn_business_date(now()) THEN
            RAISE EXCEPTION 'Chỉ chủ quán được tạo phiếu chốt cho ngày đã qua' USING ERRCODE = '42501';
        END IF;
    ELSIF (NEW.actual_cash IS DISTINCT FROM OLD.actual_cash
           OR NEW.actual_transfer IS DISTINCT FROM OLD.actual_transfer
           OR NEW.closed_at IS DISTINCT FROM OLD.closed_at)
          AND (vn_business_date(OLD.closed_at) < vn_business_date(now())
               OR vn_business_date(NEW.closed_at) < vn_business_date(now())) THEN
        RAISE EXCEPTION 'Chỉ chủ quán được sửa thực thu của ngày đã qua' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.shift_closing_cash_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_shift_closing_cash_guard ON public.shift_closings;
CREATE TRIGGER trg_shift_closing_cash_guard
    BEFORE INSERT OR UPDATE ON public.shift_closings
    FOR EACH ROW EXECUTE FUNCTION public.shift_closing_cash_guard();
