-- ==============================================================================================
-- daily_ingredient_usage — tiêu hao nguyên liệu TỪNG NGÀY, tính một lần sau khi ngày đã qua rồi giữ nguyên.
-- Để ước tính tồn quầy theo lý thuyết (xem 20261005) mà không phải tải lại cả nghìn đơn mỗi lần mở trang,
-- và để đổi công thức chỉ ảnh hưởng ngày sau. usage = { "<ingredient key>": số lượng }; ngày không có đơn
-- vẫn có dòng {} (không thì bị coi là "chưa tính" mãi). Chỉ ghi NGÀY ĐÃ QUA.
--
-- Chỉ policy SELECT + INSERT (không UPDATE/DELETE), client ghi bằng ON CONFLICT DO NOTHING → ngày đã
-- lưu không ghi đè được từ app. Sửa một ngày sai = xoá dòng trong SQL editor, lần mở sau tự tính lại:
--   DELETE FROM daily_ingredient_usage WHERE address_id = '<id>' AND day = '<YYYY-MM-DD>';
-- Quyền theo địa chỉ: admin | user_address_access | addresses.manager_id (cùng 3 nhánh với
-- get_ingredient_stocks_v2); nhân viên cũng ghi được.
-- ==============================================================================================

CREATE TABLE IF NOT EXISTS public.daily_ingredient_usage (
    address_id  uuid  NOT NULL REFERENCES public.addresses(id) ON DELETE CASCADE,
    day         date  NOT NULL,   -- ngày VN
    usage       jsonb NOT NULL CHECK (jsonb_typeof(usage) = 'object'),
    PRIMARY KEY (address_id, day)
);

ALTER TABLE public.daily_ingredient_usage ENABLE ROW LEVEL SECURITY;

-- auth.uid() bọc (SELECT ...) — xem 20260814_fix_performance_advisor_menu_rls.
DROP POLICY IF EXISTS "daily_usage_read" ON public.daily_ingredient_usage;
CREATE POLICY "daily_usage_read" ON public.daily_ingredient_usage
    FOR SELECT TO authenticated
    USING (
        (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid()))
        OR address_id IN (SELECT id FROM public.addresses WHERE manager_id = (SELECT public.auth_owner_id(auth.uid())))
    );

DROP POLICY IF EXISTS "daily_usage_insert" ON public.daily_ingredient_usage;
CREATE POLICY "daily_usage_insert" ON public.daily_ingredient_usage
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT public.is_admin_auth(auth.uid()))
        OR address_id IN (SELECT address_id FROM public.user_address_access WHERE auth_id = (SELECT auth.uid()))
        OR address_id IN (SELECT id FROM public.addresses WHERE manager_id = (SELECT public.auth_owner_id(auth.uid())))
    );

REVOKE ALL ON public.daily_ingredient_usage FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.daily_ingredient_usage TO authenticated;
