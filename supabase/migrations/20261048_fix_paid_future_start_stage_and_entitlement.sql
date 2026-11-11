-- Fix: chi nhánh ĐÃ chuyển khoản nhưng dashboard vẫn xếp "chưa trả" (expired_post) + client vẫn báo sắp hết hạn.
-- Nguyên nhân: confirm_payment gia hạn NỐI TIẾP (valid_from = MAX(valid_to)+1). Chi nhánh đang trong ân hạn/trial
-- trả tiền → hàng 'paid' có valid_from Ở TƯƠNG LAI. Cả admin_branch_stages (paid_now đòi valid_from <= hôm nay)
-- lẫn get_address_entitlement (lọc valid_from <= hôm nay) đều bỏ qua hàng đó cho tới khi ân hạn hết:
--   * dashboard: paid_now=false, ever_paid=true → 'expired_post' dù đã trả.
--   * client: valid_to = hết ân hạn → banner "sắp hết hạn" dù đã trả.
-- Sửa: "đã trả" = có hàng trả phí chưa hết hạn (kể cả bắt đầu tương lai); entitlement lấy MAX(valid_to) của chuỗi nối tiếp,
-- vẫn đòi có ít nhất 1 hàng đang hiệu lực hôm nay (không mở khoá sớm).
-- Cùng signature → CREATE OR REPLACE, khai lại search_path + guard + REVOKE/GRANT.

CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- valid_to + 3: ân hạn quá hạn (khớp EXPIRED_GRACE_DAYS ở subscriptionStatus.ts).
    -- MAX(valid_to) gồm cả hàng bắt đầu tương lai (gói trả trước nối sau ân hạn); HAVING giữ điều kiện
    -- phải có 1 hàng đang hiệu lực hôm nay.
    RETURN QUERY
    SELECT s.tier, MAX(s.valid_to)
    FROM address_subscriptions s
    WHERE s.address_id = p_address_id
      AND s.valid_to + 3 >= CURRENT_DATE
    GROUP BY s.tier
    HAVING bool_or(s.valid_from <= CURRENT_DATE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_address_entitlement(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_address_entitlement(UUID) TO authenticated;

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
                   bool_or(valid_to >= v_today AND note NOT IN ('trial', 'grace')) AS paid_now,
                   bool_or(valid_from <= v_today AND valid_to >= v_today AND note = 'trial')  AS trial_now,
                   bool_or(note NOT IN ('trial', 'grace'))                                      AS ever_paid
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
                       WHEN s.paid_now  THEN 'paid'  || CASE WHEN c.address_id IS NOT NULL THEN '_counted' ELSE '_uncounted' END
                       WHEN s.trial_now THEN 'trial' || CASE WHEN c.address_id IS NOT NULL THEN '_counted' ELSE '_uncounted' END
                       WHEN s.ever_paid                              THEN 'expired_post'
                       WHEN s.address_id IS NOT NULL                 THEN 'expired_pre'
                       WHEN o.address_id IS NOT NULL                 THEN 'ordered'
                       ELSE 'never'
                   END AS stage,
                   a.name, wg.name AS grp,
                   EXISTS (SELECT 1 FROM recent_act ra WHERE ra.address_id = a.id AND ra.d = v_today)     AS active_now,
                   EXISTS (SELECT 1 FROM recent_act ra WHERE ra.address_id = a.id AND ra.d = v_today - 1) AS active_yday
            FROM addresses a
            LEFT JOIN sub     s ON s.address_id = a.id
            LEFT JOIN ord     o ON o.address_id = a.id
            LEFT JOIN counted c ON c.address_id = a.id
            LEFT JOIN warehouse_groups wg ON wg.id = a.warehouse_group_id
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
            'active_yesterday', COUNT(*) FILTER (WHERE active_yday),
            'lists', (SELECT COALESCE(jsonb_object_agg(g.stage, g.names), '{}'::jsonb)
                      FROM (SELECT stage, jsonb_agg(jsonb_build_object('name', name, 'group', grp, 'active', active_now) ORDER BY grp NULLS LAST, name) AS names FROM staged GROUP BY stage) g)
        ) FROM staged
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_branch_stages() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_branch_stages() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_branch_stages() TO authenticated;
