-- ============================================================
-- admin_set_app_config — cho admin flip app_config từ trong app (server kill switch).
-- Bảng app_config chỉ có RLS SELECT (authenticated đọc), KHÔNG có UPDATE policy →
-- client không ghi trực tiếp được. RPC SECURITY DEFINER + guard is_admin_auth để ghi.
--
-- Dùng cho nút toggle Monetization ON/OFF ở trang /addresses (chỉ admin thấy).
-- IDEMPOTENT: CREATE OR REPLACE. Không đụng dữ liệu.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_set_app_config(
    p_key   TEXT,
    p_value TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được đổi cấu hình hệ thống'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
        RAISE EXCEPTION 'p_key không hợp lệ';
    END IF;

    INSERT INTO app_config (key, value)
    VALUES (p_key, p_value)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    RETURN p_value;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_app_config(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_app_config(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_app_config(TEXT, TEXT) TO authenticated;
