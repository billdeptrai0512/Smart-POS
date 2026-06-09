-- ============================================================
-- Monetization — Admin reconciliation RPC (Phase 1 · Bước 11 phần RPC)
-- Cấp / gia hạn gói THỦ CÔNG cho admin (mở khoá khi webhook lỗi hoặc
-- soft-launch chưa có webhook). Thay cho client insert trực tiếp vào
-- address_subscriptions (bảng chỉ có RLS SELECT — insert client không an toàn).
--
-- - SECURITY DEFINER: bypass RLS để ghi sub, nhưng tự guard bằng is_admin_auth.
-- - Quy tắc gia hạn nối tiếp (MONETIZATION.md §4): valid_from = max(today, latest.valid_to + 1)
--   → trả trước khi hết hạn thì nối tiếp, không mất ngày.
-- - Nhận nhiều chi nhánh × nhiều module trong 1 transaction (all-or-nothing).
--
-- IDEMPOTENT: CREATE OR REPLACE. Production-safe: không đụng bảng/dữ liệu hiện có.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_set_subscription(
    p_address_ids UUID[],
    p_modules     TEXT[],
    p_months      INT  DEFAULT 1,
    p_amount_paid INT  DEFAULT 0,
    p_note        TEXT DEFAULT 'admin_override'
)
RETURNS INT                       -- số row sub đã tạo
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
    -- Guard: chỉ admin. Skip khi auth.uid() IS NULL (service_role / migration bypass).
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
        RAISE EXCEPTION 'Cần ít nhất 1 module';
    END IF;

    FOREACH v_addr IN ARRAY p_address_ids LOOP
        FOREACH v_mod IN ARRAY p_modules LOOP
            IF v_mod NOT IN ('cashflow', 'inventory') THEN
                RAISE EXCEPTION 'Module không hợp lệ: %', v_mod;
            END IF;

            -- Quy tắc gia hạn nối tiếp (§4)
            SELECT COALESCE(MAX(valid_to), CURRENT_DATE - 1) + 1
              INTO v_from
              FROM address_subscriptions
             WHERE address_id = v_addr AND tier = v_mod;

            IF v_from < CURRENT_DATE THEN
                v_from := CURRENT_DATE;
            END IF;

            v_to := (v_from + (p_months || ' months')::interval)::date;

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

-- Chỉ authenticated được gọi; logic admin-guard nằm trong thân function.
REVOKE EXECUTE ON FUNCTION public.admin_set_subscription(UUID[], TEXT[], INT, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_subscription(UUID[], TEXT[], INT, INT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_subscription(UUID[], TEXT[], INT, INT, TEXT) TO authenticated;


-- ============================================================
-- admin_reset_subscription — XOÁ sub của chi nhánh (dev/test reset).
-- Để admin quay lại trạng thái khoá mà test lại flow gate.
-- p_modules = NULL → xoá tất cả module; ngược lại chỉ xoá module liệt kê.
-- SECURITY DEFINER + guard is_admin_auth (bảng chỉ có RLS SELECT, không DELETE policy).
-- ============================================================
CREATE OR REPLACE FUNCTION admin_reset_subscription(
    p_address_ids UUID[],
    p_modules     TEXT[] DEFAULT NULL
)
RETURNS INT                       -- số row đã xoá
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT := 0;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được reset gói'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_address_ids IS NULL OR array_length(p_address_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Cần ít nhất 1 chi nhánh';
    END IF;

    DELETE FROM address_subscriptions
     WHERE address_id = ANY(p_address_ids)
       AND (p_modules IS NULL OR tier = ANY(p_modules));

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reset_subscription(UUID[], TEXT[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reset_subscription(UUID[], TEXT[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_reset_subscription(UUID[], TEXT[]) TO authenticated;
