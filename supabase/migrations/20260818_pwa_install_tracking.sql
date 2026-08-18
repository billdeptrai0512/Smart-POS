-- ==============================================================================================
-- Track PWA install: bao nhiêu người thấy banner "Tải ứng dụng KOPOS" (ở /addresses, xem
-- PWAInstallPrompt.jsx) và bao nhiêu người thực sự cài. Phục vụ 1 số liệu tham khảo, chưa cần
-- dashboard riêng — đọc qua RPC pwa_install_stats() bên dưới.
--
-- iOS KHÔNG có API xác nhận cài đặt (không có beforeinstallprompt/appinstalled), nên KHÔNG track
-- installed_at bằng sự kiện. Track bằng cách phát hiện app đang chạy standalone
-- (display-mode: standalone / navigator.standalone) ngay khi component mount — đúng cho CẢ
-- iOS lẫn Android, vì Android cũng vào standalone sau khi cài dù cài qua nút của ta hay qua
-- menu trình duyệt. Xem detectStandalone() trong PWAInstallPrompt.jsx.
--
-- Chỉ user đã đăng nhập thật mới chạm tới 2 RPC ghi bên dưới: guest dùng thử (handleGuest) đi
-- thẳng /pos, không qua /addresses (xem LoginPage.jsx) — nên không cần nhánh anon như
-- guest_onboarding_funnel.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS pwa_installs (
    auth_id       UUID PRIMARY KEY REFERENCES auth.users(id),
    platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'other')),
    shown_at      TIMESTAMPTZ,
    installed_at  TIMESTAMPTZ
);

-- RLS bật, không khai policy → deny toàn bộ truy cập trực tiếp. Lối vào duy nhất là 3 hàm
-- SECURITY DEFINER bên dưới (ghi: tự-scope theo auth.uid(); đọc: admin).
ALTER TABLE pwa_installs ENABLE ROW LEVEL SECURITY;

-- ─── Ghi: banner đã hiện ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION track_pwa_shown(p_platform TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR p_platform NOT IN ('ios', 'android', 'other') THEN
        RETURN;
    END IF;

    INSERT INTO pwa_installs (auth_id, platform, shown_at)
    VALUES (auth.uid(), p_platform, now())
    ON CONFLICT (auth_id) DO UPDATE
        SET shown_at = COALESCE(pwa_installs.shown_at, now());
END;
$$;

REVOKE EXECUTE ON FUNCTION track_pwa_shown(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION track_pwa_shown(TEXT) TO authenticated;

-- ─── Ghi: đã phát hiện chạy standalone (= đã cài) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION track_pwa_installed(p_platform TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL OR p_platform NOT IN ('ios', 'android', 'other') THEN
        RETURN;
    END IF;

    INSERT INTO pwa_installs (auth_id, platform, installed_at)
    VALUES (auth.uid(), p_platform, now())
    ON CONFLICT (auth_id) DO UPDATE
        SET installed_at = COALESCE(pwa_installs.installed_at, now()),
            platform      = EXCLUDED.platform;
END;
$$;

REVOKE EXECUTE ON FUNCTION track_pwa_installed(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION track_pwa_installed(TEXT) TO authenticated;

-- ─── Đọc (admin) ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pwa_install_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem thống kê này';
    END IF;

    RETURN jsonb_build_object(
        'shown',        (SELECT COUNT(*) FROM pwa_installs WHERE shown_at IS NOT NULL),
        'installed',    (SELECT COUNT(*) FROM pwa_installs WHERE installed_at IS NOT NULL),
        'by_platform',  (
            SELECT COALESCE(jsonb_object_agg(platform, cnt), '{}'::jsonb)
            FROM (
                SELECT platform, COUNT(*) AS cnt
                FROM pwa_installs
                WHERE installed_at IS NOT NULL
                GROUP BY platform
            ) t
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION pwa_install_stats() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION pwa_install_stats() TO authenticated;

COMMIT;
