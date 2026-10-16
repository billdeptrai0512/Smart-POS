-- admin_branch_stages v2: phễu chuyển đổi 8 nhóm LOẠI TRỪ NHAU (mỗi địa chỉ còn sống đúng 1 nhóm).
-- Khác v1 (20261020):
--   • Bỏ 'cash_closed' ("nhập thực thu nhưng chưa có trial"): trial giờ tự cấp ở lần lưu thực thu có tiền + có đơn
--     (852d430), nhập thực thu 0 / không đơn = đang test → rơi về 'ordered'/'never'. Địa chỉ đã chốt ca TRƯỚC trigger và
--     chưa có dòng gói (đang free vĩnh viễn) cũng rơi về 'ordered' — kiểm tra bằng query chẩn đoán trước khi apply.
--   • Tách trial / paid theo "đã kiểm kê": counted = có ít nhất 1 entry inventory_report với `remaining` khác null
--     (đã từng đếm tồn thật; entry tombstone/chỉ có Nhập thêm không tính). Kiểm kê là tính năng sống còn nhưng trigger
--     trial không đòi → cần thấy bao nhiêu chi nhánh dùng thử/trả phí mà KHÔNG kiểm kê.
--   • Tách 'expired' làm 2: expired_pre (hết hạn, chưa từng có gói trả phí) và expired_post (từng trả phí, giờ hết hạn).
-- Trả: never, ordered, trial_counted, trial_uncounted, expired_pre, paid_counted, paid_uncounted, expired_post,
-- + active_today / active_yesterday như cũ. Cùng signature → CREATE OR REPLACE, khai lại search_path + guard + REVOKE/GRANT.
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
        counted AS (
            SELECT DISTINCT sc.address_id
            FROM shift_closings sc
            CROSS JOIN LATERAL jsonb_array_elements(sc.inventory_report) e
            WHERE e->>'remaining' IS NOT NULL
        ),
        sub AS (
            SELECT address_id,
                   bool_or(valid_from <= v_today AND valid_to >= v_today AND note <> 'trial') AS paid_now,
                   bool_or(valid_from <= v_today AND valid_to >= v_today AND note = 'trial')  AS trial_now,
                   bool_or(note <> 'trial')                                                   AS ever_paid
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
                       WHEN s.paid_now  AND c.address_id IS NOT NULL THEN 'paid_counted'
                       WHEN s.paid_now                               THEN 'paid_uncounted'
                       WHEN s.trial_now AND c.address_id IS NOT NULL THEN 'trial_counted'
                       WHEN s.trial_now                              THEN 'trial_uncounted'
                       WHEN s.ever_paid                              THEN 'expired_post'
                       WHEN s.address_id IS NOT NULL                 THEN 'expired_pre'
                       WHEN o.address_id IS NOT NULL                 THEN 'ordered'
                       ELSE 'never'
                   END AS stage,
                   EXISTS (SELECT 1 FROM recent_act ra WHERE ra.address_id = a.id AND ra.d = v_today)     AS active_now,
                   EXISTS (SELECT 1 FROM recent_act ra WHERE ra.address_id = a.id AND ra.d = v_today - 1) AS active_yday
            FROM addresses a
            LEFT JOIN sub     s ON s.address_id = a.id
            LEFT JOIN ord     o ON o.address_id = a.id
            LEFT JOIN counted c ON c.address_id = a.id
            WHERE a.deleted_at IS NULL
        )
        SELECT jsonb_build_object(
            'never',           COUNT(*) FILTER (WHERE stage = 'never'),
            'ordered',         COUNT(*) FILTER (WHERE stage = 'ordered'),
            'trial_counted',   COUNT(*) FILTER (WHERE stage = 'trial_counted'),
            'trial_uncounted', COUNT(*) FILTER (WHERE stage = 'trial_uncounted'),
            'expired_pre',     COUNT(*) FILTER (WHERE stage = 'expired_pre'),
            'paid_counted',    COUNT(*) FILTER (WHERE stage = 'paid_counted'),
            'paid_uncounted',  COUNT(*) FILTER (WHERE stage = 'paid_uncounted'),
            'expired_post',    COUNT(*) FILTER (WHERE stage = 'expired_post'),
            'active_today',    COUNT(*) FILTER (WHERE active_now),
            'active_yesterday', COUNT(*) FILTER (WHERE active_yday)
        ) FROM staged
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_branch_stages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_branch_stages() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_branch_stages() TO authenticated;
