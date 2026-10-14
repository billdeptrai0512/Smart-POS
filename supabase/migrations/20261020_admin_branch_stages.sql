-- Phễu giai đoạn chi nhánh cho /admin/dashboard: mỗi địa chỉ CÒN SỐNG (deleted_at IS NULL) nằm đúng 1
-- nhóm → các nhóm cộng lại = tổng địa chỉ. Thay cho 3 bucket "stuck" của admin_funnel_cohorts (không
-- lọc địa chỉ đã xóa mềm nên phồng số) và trial_count/paid_count của overview (cũng không lọc).
-- Thứ tự ưu tiên: đang trả phí > đang dùng thử > hết hạn (từng có gói, giờ không còn) > chưa có gói
-- (chia theo đã có đơn / đã nhập thực thu chưa). RPC riêng, không đụng overview() 447 dòng.
-- Kèm active_today / active_yesterday = số chi nhánh CÒN SỐNG có đơn hoặc ca hôm nay / cả ngày hôm qua (giờ VN), kể cả chưa có gói.
-- Cuối file drop 2 RPC đã thừa: admin_active_today (gộp vào đây), admin_funnel_cohorts (không còn client gọi,
-- và không lọc địa chỉ đã xóa mềm).
CREATE OR REPLACE FUNCTION admin_branch_stages()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today DATE := vn_business_date(now());
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN (
        WITH ord AS (
            SELECT address_id FROM orders WHERE deleted_at IS NULL GROUP BY address_id
        ),
        cash_closed AS (
            SELECT address_id FROM shift_closings WHERE cash_closed_at IS NOT NULL GROUP BY address_id
        ),
        sub AS (
            SELECT address_id,
                   bool_or(valid_from <= v_today AND valid_to >= v_today AND note <> 'trial') AS paid_now,
                   bool_or(valid_from <= v_today AND valid_to >= v_today AND note = 'trial')  AS trial_now
            FROM address_subscriptions
            GROUP BY address_id
        ),
        recent_act AS (
            SELECT address_id, vn_business_date(created_at) AS d FROM orders
            WHERE deleted_at IS NULL AND vn_business_date(created_at) >= v_today - 1
            UNION
            SELECT address_id, vn_business_date(closed_at) FROM shift_closings
            WHERE vn_business_date(closed_at) >= v_today - 1
        ),
        staged AS (
            SELECT CASE
                       WHEN s.paid_now  THEN 'paid'
                       WHEN s.trial_now THEN 'trial'
                       WHEN s.address_id IS NOT NULL THEN 'expired'
                       WHEN cc.address_id IS NOT NULL THEN 'cash_closed'
                       WHEN o.address_id  IS NOT NULL THEN 'ordered'
                       ELSE 'never'
                   END AS stage,
                   EXISTS (SELECT 1 FROM recent_act ra WHERE ra.address_id = a.id AND ra.d = v_today)     AS active_now,
                   EXISTS (SELECT 1 FROM recent_act ra WHERE ra.address_id = a.id AND ra.d = v_today - 1) AS active_yday
            FROM addresses a
            LEFT JOIN sub         s  ON s.address_id  = a.id
            LEFT JOIN ord         o  ON o.address_id  = a.id
            LEFT JOIN cash_closed cc ON cc.address_id = a.id
            WHERE a.deleted_at IS NULL
        )
        SELECT jsonb_build_object(
            'never',       COUNT(*) FILTER (WHERE stage = 'never'),
            'ordered',     COUNT(*) FILTER (WHERE stage = 'ordered'),
            'cash_closed', COUNT(*) FILTER (WHERE stage = 'cash_closed'),
            'trial',       COUNT(*) FILTER (WHERE stage = 'trial'),
            'paid',        COUNT(*) FILTER (WHERE stage = 'paid'),
            'expired',     COUNT(*) FILTER (WHERE stage = 'expired'),
            'active_today', COUNT(*) FILTER (WHERE active_now),
            'active_yesterday', COUNT(*) FILTER (WHERE active_yday)
        ) FROM staged
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_branch_stages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_branch_stages() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_branch_stages() TO authenticated;

DROP FUNCTION IF EXISTS public.admin_active_today();
DROP FUNCTION IF EXISTS public.admin_funnel_cohorts(INT);
