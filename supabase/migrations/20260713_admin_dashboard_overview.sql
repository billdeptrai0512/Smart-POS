-- ============================================================
-- Admin Dashboard — 1 RPC tổng hợp toàn bộ số liệu billing/customer-health
-- cross-branch cho trang /admin/dashboard. Không có RPC report nào hiện có
-- phù hợp: get_report_by_range/get_branches_today_stats đều RLS theo chi
-- nhánh của người gọi, còn dashboard này cần nhìn TOÀN HỆ THỐNG.
--
-- 1 round-trip duy nhất trả về JSONB — dashboard cần đọc nhanh (5 giây),
-- không muốn client waterfall nhiều query nhỏ.
--
-- CHỦ ĐÍCH KHÔNG trả: MRR/ARR quy đổi, GMV/đơn hàng toàn hệ thống. Đây là
-- billing dashboard theo chi nhánh trả trước 6 tháng/lần (không phải
-- recurring monthly thật) — MRR/ARR chỉ là số ước tính cần chú thích mới
-- khỏi hiểu lầm, và không trả lời câu hỏi nào trong 8 câu hỏi bắt buộc của
-- dashboard này. GMV/đơn hàng toàn hệ thống cũng vậy: tín hiệu "chi nhánh có
-- dùng thật không" đã có sẵn per-branch trong `attention` (last_active_at),
-- 1 con số gộp toàn hệ thống không dẫn tới hành động nào. Xem lại nếu sau
-- này cần benchmark tăng trưởng dài hạn.
--
-- Quy ước dùng để phân loại (không có cột status trên address_subscriptions,
-- đây là sổ cái nối tiếp — xem CLAUDE.md/docs cho model):
--   - "revenue thật"  = payment_intent_id IS NOT NULL (tiền đã qua cổng
--     thanh toán, loại trừ trial/admin_override/referral_reward vốn có
--     amount_paid thường = 0 và không gắn payment_intent).
--   - "khách mới"     = address có first_paid_at (dòng revenue-thật sớm
--     nhất) rơi vào kỳ đang xét.
--   - "đang trả phí"  = dòng đang hiệu lực (valid_from..valid_to bao hôm
--     nay) có note <> 'trial', lấy dòng valid_to lớn nhất làm dominant.
--   - "đã rời bỏ"     = từng có revenue thật, nhưng hiện không còn dòng
--     nào đang hiệu lực (KHÔNG tính các địa chỉ chưa từng trả tiền).
--
-- Read-only, không đụng dữ liệu — an toàn chạy lại (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION admin_dashboard_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now          TIMESTAMPTZ := now();
    v_today        DATE := vn_business_date(v_now);
    v_month_start  DATE := date_trunc('month', v_today)::date;
    v_prev_start   DATE := (date_trunc('month', v_today) - INTERVAL '1 month')::date;
    v_chart_start  DATE := (date_trunc('month', v_today) - INTERVAL '5 months')::date;
    v_result       JSONB;
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    WITH first_paid AS (
        SELECT address_id, MIN(created_at) AS first_paid_at
        FROM address_subscriptions
        WHERE payment_intent_id IS NOT NULL
        GROUP BY address_id
    ),
    revenue_this_month AS (
        SELECT COALESCE(SUM(amount_paid), 0)::bigint AS amt
        FROM address_subscriptions
        WHERE payment_intent_id IS NOT NULL AND vn_business_date(created_at) >= v_month_start
    ),
    revenue_last_month AS (
        SELECT COALESCE(SUM(amount_paid), 0)::bigint AS amt
        FROM address_subscriptions
        WHERE payment_intent_id IS NOT NULL
          AND vn_business_date(created_at) >= v_prev_start
          AND vn_business_date(created_at) < v_month_start
    ),
    monthly_series AS (
        SELECT
            to_char(date_trunc('month', vn_business_date(created_at)), 'YYYY-MM') AS month,
            COALESCE(SUM(amount_paid), 0)::bigint AS amount
        FROM address_subscriptions
        WHERE payment_intent_id IS NOT NULL AND vn_business_date(created_at) >= v_chart_start
        GROUP BY 1
        ORDER BY 1
    ),
    new_paid_this_month AS (
        SELECT COUNT(*) AS n FROM first_paid WHERE vn_business_date(first_paid_at) >= v_month_start
    ),
    active_rows AS (
        SELECT * FROM address_subscriptions
        WHERE valid_from <= v_today AND valid_to >= v_today
    ),
    dominant AS (
        SELECT DISTINCT ON (address_id) address_id, note, valid_to
        FROM active_rows
        ORDER BY address_id, valid_to DESC
    ),
    paid_addresses AS (
        SELECT address_id, valid_to FROM dominant WHERE note <> 'trial'
    ),
    trial_addresses AS (
        SELECT address_id, valid_to FROM dominant WHERE note = 'trial'
    ),
    churned_addresses AS (
        SELECT fp.address_id
        FROM first_paid fp
        WHERE NOT EXISTS (SELECT 1 FROM dominant d WHERE d.address_id = fp.address_id)
    ),
    expiring_soon AS (
        SELECT address_id, valid_to FROM paid_addresses WHERE valid_to <= v_today + 7
    ),
    trial_starts AS (
        SELECT address_id, MIN(valid_from) AS trial_start
        FROM address_subscriptions WHERE note = 'trial'
        GROUP BY address_id
    ),
    conversion AS (
        SELECT
            COUNT(*) FILTER (WHERE trial_start >= v_today - 30) AS trial_30d,
            COUNT(*) FILTER (
                WHERE trial_start >= v_today - 30
                  AND ts.address_id IN (SELECT address_id FROM first_paid)
            ) AS converted_30d
        FROM trial_starts ts
    ),
    last_active AS (
        SELECT
            COALESCE(ao.address_id, ashi.address_id) AS address_id,
            GREATEST(ao.last_order, ashi.last_shift) AS last_active_at
        FROM (SELECT address_id, MAX(created_at) AS last_order FROM orders WHERE deleted_at IS NULL GROUP BY address_id) ao
        FULL JOIN (SELECT address_id, MAX(closed_at) AS last_shift FROM shift_closings GROUP BY address_id) ashi
            ON ashi.address_id = ao.address_id
    ),
    attention_raw AS (
        SELECT
            a.id AS address_id, a.name, u.name AS owner_name, u.phone AS owner_phone,
            'expiring'::text AS reason, es.valid_to, la.last_active_at,
            NULL::text AS reference, NULL::bigint AS amount
        FROM expiring_soon es
        JOIN addresses a ON a.id = es.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = es.address_id

        UNION ALL

        SELECT
            a.id, a.name, u.name, u.phone,
            'inactive', pa.valid_to, la.last_active_at,
            NULL, NULL
        FROM paid_addresses pa
        JOIN addresses a ON a.id = pa.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = pa.address_id
        WHERE la.last_active_at IS NULL OR la.last_active_at < v_now - INTERVAL '14 days'

        UNION ALL

        SELECT
            a.id, COALESCE(a.name, 'SP' || pi.reference), u.name, u.phone,
            'payment_review', NULL, NULL,
            pi.reference, pi.amount
        FROM payment_intents pi
        LEFT JOIN addresses a ON a.id = pi.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        WHERE pi.status = 'manual_review'
    ),
    attention_ranked AS (
        SELECT *
        FROM attention_raw
        ORDER BY
            CASE reason WHEN 'payment_review' THEN 0 WHEN 'expiring' THEN 1 ELSE 2 END,
            valid_to ASC NULLS LAST,
            last_active_at ASC NULLS FIRST
        LIMIT 20
    ),
    recent_payments AS (
        SELECT
            'payment'::text AS type, a.name AS address_name,
            CASE WHEN fp.first_paid_at = s.created_at THEN 'Thanh toán lần đầu' ELSE 'Gia hạn ' || s.months || ' tháng' END AS detail,
            s.created_at AS at
        FROM address_subscriptions s
        JOIN addresses a ON a.id = s.address_id
        LEFT JOIN first_paid fp ON fp.address_id = s.address_id
        WHERE s.payment_intent_id IS NOT NULL
        ORDER BY s.created_at DESC LIMIT 5
    ),
    recent_branches AS (
        SELECT 'new_branch'::text, name, 'Chi nhánh mới'::text, created_at
        FROM addresses ORDER BY created_at DESC LIMIT 5
    ),
    recent_referrals AS (
        SELECT 'referral'::text, name, 'Referral thưởng'::text, referral_rewarded_at
        FROM addresses WHERE referral_rewarded_at IS NOT NULL
        ORDER BY referral_rewarded_at DESC LIMIT 3
    ),
    recent_reviews AS (
        SELECT 'review'::text, COALESCE(a.name, 'SP' || pi.reference), 'Thanh toán treo'::text, pi.created_at
        FROM payment_intents pi
        LEFT JOIN addresses a ON a.id = pi.address_id
        WHERE pi.status = 'manual_review'
        ORDER BY pi.created_at DESC LIMIT 3
    ),
    activity_feed AS (
        SELECT * FROM recent_payments
        UNION ALL SELECT * FROM recent_branches
        UNION ALL SELECT * FROM recent_referrals
        UNION ALL SELECT * FROM recent_reviews
        ORDER BY 4 DESC
        LIMIT 10
    )
    SELECT jsonb_build_object(
        'generated_at', v_now,
        'revenue', jsonb_build_object(
            'this_month', (SELECT amt FROM revenue_this_month),
            'last_month', (SELECT amt FROM revenue_last_month),
            'monthly_series', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'month', month, 'amount', amount
            )), '[]'::jsonb) FROM monthly_series)
        ),
        'subscription', jsonb_build_object(
            'paid_count', (SELECT COUNT(*) FROM paid_addresses),
            'trial_count', (SELECT COUNT(*) FROM trial_addresses),
            'churned_count', (SELECT COUNT(*) FROM churned_addresses),
            'expiring_soon_count', (SELECT COUNT(*) FROM expiring_soon),
            'new_paid_this_month', (SELECT n FROM new_paid_this_month),
            'conversion_rate_30d', (
                SELECT CASE WHEN trial_30d = 0 THEN NULL ELSE ROUND(converted_30d::numeric / trial_30d * 100, 1) END
                FROM conversion
            )
        ),
        'attention', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'address_id', address_id, 'name', name, 'owner_name', owner_name, 'owner_phone', owner_phone,
            'reason', reason, 'valid_to', valid_to, 'last_active_at', last_active_at,
            'reference', reference, 'amount', amount
        )), '[]'::jsonb) FROM attention_ranked),
        'activity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'type', type, 'address_name', address_name, 'detail', detail, 'at', at
        )), '[]'::jsonb) FROM activity_feed)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_dashboard_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_overview() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_dashboard_overview() TO authenticated;
