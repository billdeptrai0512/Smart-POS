-- ============================================================
-- Nút "Mock mở khoá (Admin)" ở SubscriptionPanel: cấp trial 7 ngày
-- thay vì admin_override 6 tháng — test không tốn 6 tháng sub thật,
-- và dùng được để cấp lại trial thủ công khi trial tự động bị chặn
-- (vd: phone đã "cháy" do delete+recreate address — xem 20260622).
--
-- CHỈ đổi hành vi khi p_note = 'trial' (7 ngày cố định, bỏ qua p_months).
-- Mọi note khác (admin_override/paid thật) giữ nguyên tính theo p_months.
-- Cùng chữ ký hàm → không cần REVOKE/GRANT lại.
-- IDEMPOTENT.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_set_subscription(
    p_address_ids UUID[],
    p_modules     TEXT[],
    p_months      INT  DEFAULT 1,
    p_amount_paid INT  DEFAULT 0,
    p_note        TEXT DEFAULT 'admin_override'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_addr  UUID;
    v_mod   TEXT;
    v_from  DATE;
    v_to    DATE;
    v_count INT := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được cấp gói thủ công'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_months IS NULL OR p_months < 1 THEN
        RAISE EXCEPTION 'p_months phải >= 1';
    END IF;
    IF p_address_ids IS NULL OR array_length(p_address_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Cần ít nhất 1 chi nhánh';
    END IF;
    IF p_modules IS NULL OR array_length(p_modules, 1) IS NULL THEN
        RAISE EXCEPTION 'Cần ít nhất 1 gói';
    END IF;

    FOREACH v_addr IN ARRAY p_address_ids LOOP
        FOREACH v_mod IN ARRAY p_modules LOOP
            IF v_mod <> 'all' THEN
                RAISE EXCEPTION 'Gói không hợp lệ: %', v_mod;
            END IF;

            -- Quy tắc gia hạn nối tiếp (§4)
            SELECT COALESCE(MAX(valid_to), CURRENT_DATE - 1) + 1
              INTO v_from
              FROM address_subscriptions
             WHERE address_id = v_addr AND tier = v_mod;

            IF v_from < CURRENT_DATE THEN
                v_from := CURRENT_DATE;
            END IF;

            -- note='trial' → 7 ngày cố định (khớp TRIAL_DAYS phía client), bỏ qua p_months.
            v_to := CASE WHEN p_note = 'trial'
                THEN v_from + 7
                ELSE (v_from + (p_months || ' months')::interval)::date
            END;

            INSERT INTO address_subscriptions
                (address_id, tier, valid_from, valid_to, months, amount_paid, note)
            VALUES
                (v_addr, v_mod, v_from, v_to, p_months, COALESCE(p_amount_paid, 0), p_note);

            v_count := v_count + 1;
        END LOOP;
    END LOOP;

    RETURN v_count;
END;
$$;
