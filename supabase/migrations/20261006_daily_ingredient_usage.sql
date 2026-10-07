-- ==============================================================================================
-- daily_ingredient_usage — tiêu hao nguyên liệu TỪNG NGÀY, lưu lại sau khi ngày đã qua.
--
-- Vì sao: "đã dùng bao nhiêu" chỉ tính được từ đơn × công thức (client), DB không có. Ước tính tồn
-- quầy theo lý thuyết (xem 20261005_ingredient_stocks_counted_on.sql) cần tiêu hao của mọi ngày từ
-- lần đếm cuối — tải lại cả nghìn đơn mỗi lần mở trang thì chậm, và đổi công thức sẽ làm số ngày
-- cũ đổi theo. Lưu mỗi ngày một dòng: tính MỘT lần (lười — lần đầu có ai mở trang sau ngày đó), từ
-- đó ngày đã qua là số cố định.
--
-- usage = { "<ingredient key>": <số lượng theo đơn vị của NVL> }; ngày không có đơn vẫn có dòng với
-- {} (nếu không sẽ bị coi là "chưa tính" và tải lại mãi). Chỉ ghi NGÀY ĐÃ QUA — hôm nay còn chạy.
--
-- Chỉ có policy SELECT + INSERT (không UPDATE/DELETE) và client ghi bằng ON CONFLICT DO NOTHING:
--   - ngày đã lưu không ai ghi đè được từ app (đóng băng, và 2 máy cùng tính thì máy tới trước thắng);
--   - sửa một ngày sai = xoá dòng đó trong SQL editor, lần mở sau sẽ tính lại:
--       DELETE FROM daily_ingredient_usage WHERE address_id = '<id>' AND day = '<YYYY-MM-DD>';
-- Quyền theo địa chỉ: admin, hoặc địa chỉ có trong user_address_access, hoặc chủ quản lý trực tiếp
-- (addresses.manager_id) — cùng 3 nhánh với ownership guard của get_ingredient_stocks_v2. Nhân viên
-- cũng phải ghi được (ai mở trang tồn kho đều có thể là người kích hoạt việc tính).
-- Số do client tự tính nên người có quyền ghi được số sai; nó chỉ ảnh hưởng ước tính tồn quầy,
-- không đụng sổ tiền.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_ingredient_usage (
    address_id  uuid        NOT NULL REFERENCES public.addresses(id) ON DELETE CASCADE,
    day         date        NOT NULL,   -- ngày VN
    usage       jsonb       NOT NULL CHECK (jsonb_typeof(usage) = 'object'),
    computed_at timestamptz NOT NULL DEFAULT now(),
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

COMMIT;
