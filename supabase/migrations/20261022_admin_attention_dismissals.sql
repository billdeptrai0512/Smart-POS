-- "Bỏ qua" cho các dòng trong "Cần chú ý" của dashboard admin (hiện dùng cho reason 'trial_missing').
-- Chỉ ẨN dòng khỏi danh sách — KHÔNG đụng tới gói/trial: nếu chi nhánh sau này chốt thực thu đủ điều kiện,
-- trigger cấp trial vẫn chạy bình thường. Bảng không có policy nào (deny-all với client); chỉ đọc/ghi qua
-- admin_dismiss_attention() và admin_dashboard_overview() (đều SECURITY DEFINER).
CREATE TABLE IF NOT EXISTS admin_attention_dismissals (
    address_id   UUID        NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    reason       TEXT        NOT NULL,
    dismissed_by UUID,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (address_id, reason)
);
ALTER TABLE admin_attention_dismissals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION admin_dismiss_attention(p_address_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được bỏ qua mục cần chú ý'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    INSERT INTO admin_attention_dismissals (address_id, reason, dismissed_by)
    VALUES (p_address_id, p_reason, auth.uid())
    ON CONFLICT (address_id, reason) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_dismiss_attention(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_dismiss_attention(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_dismiss_attention(UUID, TEXT) TO authenticated;
