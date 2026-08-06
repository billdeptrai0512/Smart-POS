-- ==============================================================================================
-- Phễu onboarding khách dùng thử — đếm bao nhiêu người vào "Dùng thử miễn phí" và đi tới được
-- phase nào trong 6 phase onboarding (xem OnboardingGuide.jsx + steps/*.jsx), phục vụ 1 card
-- trên /admin/dashboard.
--
-- Track theo STAGE (0-6, thô), KHÔNG theo từng sự kiện con trong checklist (vd không có dòng
-- nào cho "đã giữ card Cà phê sữa") — quyết định phạm vi rõ ràng của product owner.
--   stage 0 = đã vào dùng thử, chưa xong phase nào
--   stage 1-5 = đã xong bấy nhiêu phase
--   stage 6 = xong cả 6 phase (guide chuyển sang CTA đăng ký tài khoản)
-- Thêm/bớt phase trong STEPS → phải sửa đồng thời 3 chỗ: CHECK bên dưới, generate_series(0,6)
-- trong guest_onboarding_funnel_stats(), và CASE nhãn trong cùng hàm đó.
--
-- Guest mode KHÔNG có identity thật: DEMO_ADDRESS_ID = 'demo-address-uuid-123'
-- (localRepository.ts) là literal CỐ ĐỊNH dùng chung cho MỌI trình duyệt khách, đếm theo nó thì
-- cả thế giới gom về 1 dòng. Nên client tự mint visitor_id riêng (crypto.randomUUID(), lưu
-- localStorage key `guest_funnel_visitor_id` — xem onboardingFunnelService.js).
--
-- Đây là lần ĐẦU TIÊN guest (chưa đăng nhập) được phép ghi vào Supabase — mọi service khác vẫn
-- chặn guest ở localRepo.isGuest() như cũ. Ngoại lệ hẹp, có chủ đích, chỉ qua đúng RPC dưới đây.
--
-- QUYẾT ĐỊNH PHẠM VI (không phải chỗ bỏ sót): KHÔNG rate-limit/chống spam ngoài CHECK constraint
-- + upsert idempotent (GREATEST → gọi lại không bao giờ đếm trùng hay lùi số). Đây là số liệu
-- nội bộ để tham khảo, không phải billing/bảo mật — kẻ spam chỉ tạo thêm hàng vô hại, không tốn
-- tiền, không lộ dữ liệu quán nào. Nếu sau này số liệu lệch bất thường thì lọc theo first_seen_at
-- hoặc xoá hàng nghi ngờ, chưa cần dựng rate-limiter.
-- ==============================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS guest_onboarding_funnel (
    visitor_id     UUID PRIMARY KEY,
    max_stage      SMALLINT NOT NULL CHECK (max_stage BETWEEN 0 AND 6),
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Mốc cuối: khách dùng thử này đã đăng ký tài khoản thật (mark_guest_funnel_signup bên dưới).
    -- Cột riêng chứ KHÔNG phải stage 7, vì đăng ký không nằm trong STEPS và không nhất thiết đi sau
    -- max_stage = 6 — có người đăng ký từ giữa chừng.
    signed_up_at   TIMESTAMPTZ
);

-- Cho phép apply lại file này lên bảng đã tạo từ bản trước (chưa có signed_up_at).
ALTER TABLE guest_onboarding_funnel ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ;

-- RLS bật nhưng KHÔNG khai policy nào → deny toàn bộ truy cập trực tiếp cho anon/authenticated.
-- Lối vào duy nhất là 2 hàm SECURITY DEFINER bên dưới (ghi: anon; đọc: admin).
-- Không index thêm ngoài PK: số dòng scale theo "số trình duyệt khách từng vào", không phải
-- theo lượng giao dịch — seq scan ở quy mô đó là thừa đủ.
ALTER TABLE guest_onboarding_funnel ENABLE ROW LEVEL SECURITY;

-- ─── Ghi (anon, gọi từ trình duyệt khách dùng thử) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION track_guest_onboarding_stage(p_visitor_id UUID, p_stage SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Im lặng bỏ qua input sai thay vì RAISE: client gọi kiểu fire-and-forget, không ai đọc lỗi,
    -- và 1 stage ngoài khoảng không đáng làm hỏng gì cả.
    IF p_visitor_id IS NULL OR p_stage IS NULL OR p_stage < 0 OR p_stage > 6 THEN
        RETURN;
    END IF;

    INSERT INTO guest_onboarding_funnel (visitor_id, max_stage, first_seen_at, last_seen_at)
    VALUES (p_visitor_id, p_stage, now(), now())
    ON CONFLICT (visitor_id) DO UPDATE
        SET max_stage    = GREATEST(guest_onboarding_funnel.max_stage, EXCLUDED.max_stage),
            last_seen_at = now();
END;
$$;

-- NGOẠI LỆ CHỦ ĐÍCH so với quy ước thường trong CLAUDE.md (GRANT chỉ cho authenticated): hàm này
-- phục vụ khách dùng thử nên phải cấp cho anon.
-- Cấp CẢ authenticated, không phải cho chặt: guest mode của app độc lập với session Supabase —
-- máy còn session cũ mà bấm "Dùng thử miễn phí" thì role vẫn là authenticated, chỉ grant anon là
-- khách đó bị 42501 và IM LẶNG không được đếm (đã gặp thật lúc verify). Nới ra không mất gì: tối đa
-- ghi được 1 số 0-6 vào 1 UUID, upsert GREATEST nên không lùi số, không đụng dữ liệu quán nào.
REVOKE EXECUTE ON FUNCTION track_guest_onboarding_stage(UUID, SMALLINT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION track_guest_onboarding_stage(UUID, SMALLINT) TO anon, authenticated;

-- ─── Đánh dấu đã đăng ký (gọi ngay sau khi signUp thành công) ─────────────────────────────────
-- UPDATE-only, KHÔNG insert: không có dòng nghĩa là người này chưa từng vào dùng thử → không có gì
-- để quy công. COALESCE giữ lần đăng ký ĐẦU (1 visitor_id chỉ đổi từ NULL sang có 1 lần).
-- Grant cả anon lẫn authenticated vì tuỳ luồng signUp mà session có thể đã tồn tại hay chưa tại
-- thời điểm gọi. An toàn: muốn bẩn dữ liệu phải đoán trúng UUID có sẵn, và cũng chỉ set được 1 cờ.
CREATE OR REPLACE FUNCTION mark_guest_funnel_signup(p_visitor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_visitor_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE guest_onboarding_funnel
       SET signed_up_at = COALESCE(signed_up_at, now())
     WHERE visitor_id = p_visitor_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_guest_funnel_signup(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION mark_guest_funnel_signup(UUID) TO anon, authenticated;

-- ─── Đọc (admin, cho card trên /admin/dashboard) ──────────────────────────────────────────────
-- Tách RPC riêng thay vì nhét thêm 1 CTE vào admin_dashboard_overview(): hàm đó body 378 dòng và
-- quy ước của nó là CREATE OR REPLACE nguyên body, chép lại chừng ấy dòng chỉ để thêm ~12 dòng là
-- rủi ro không đáng — CLAUDE.md ghi nhận đúng pattern này đã gây 4 đợt Security Advisor
-- regression. Đổi lại: thêm 1 round-trip trên trang admin (chấp nhận được, trang chỉ admin mở).
CREATE OR REPLACE FUNCTION guest_onboarding_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Guard giống hệt admin_dashboard_overview() (20260715_admin_dashboard_activity_ratings.sql).
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard';
    END IF;

    -- Trả { stages: [...], signup: {...} } chứ KHÔNG nhét đăng ký thành "stage 7": stages là chuỗi
    -- LỒNG NHAU (max_stage >= N, luôn giảm dần), còn đăng ký là tập khác — người đăng ký từ stage 2
    -- vẫn tính. Nhét chung 1 mảng thì dòng cuối phình to hơn dòng trên, nhìn như phễu hỏng.
    --   signup.after_complete = xong hết guide RỒI đăng ký → nối tiếp được vào phễu (⊆ stage 6)
    --   signup.early          = đăng ký khi chưa hết guide → tín hiệu TỐT (bị thuyết phục sớm),
    --                           để riêng ngoài phễu
    RETURN jsonb_build_object('stages', (
        -- generate_series để LUÔN trả đủ 7 dòng (stage 0-6) kể cả mốc chưa ai đạt tới (count = 0) —
        -- không phụ thuộc dữ liệu sẵn có, card ở client khỏi phải tự vá chỗ trống.
        -- visitor_id là PK nên COUNT(*) đã là distinct sẵn.
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'stage', gs.stage,
            -- Nhãn = TÊN PHASE VỪA XONG (khớp `name` trong steps/*.jsx), không phải phase đang làm:
            -- stage 3 nghĩa là "đã xong 3 phase", phase thứ 3 là cashReportStep = 'Kết ca đếm tiền'.
            'label', CASE gs.stage
                WHEN 0 THEN 'Vào dùng thử'
                WHEN 1 THEN 'Xong: Bấm tạo đơn'
                WHEN 2 THEN 'Xong: Nhật ký'
                WHEN 3 THEN 'Xong: Kết ca đếm tiền'
                WHEN 4 THEN 'Xong: Kiểm kê tồn kho'
                WHEN 5 THEN 'Xong: Cài công thức'
                WHEN 6 THEN 'Xong: Cài đặt nguyên liệu (hết guide)'
            END,
            'count', (SELECT COUNT(*) FROM guest_onboarding_funnel f WHERE f.max_stage >= gs.stage)
        ) ORDER BY gs.stage), '[]'::jsonb)
        FROM generate_series(0, 6) AS gs(stage)
    ), 'signup', (
        SELECT jsonb_build_object(
            'after_complete', COUNT(*) FILTER (WHERE max_stage = 6),
            'early',          COUNT(*) FILTER (WHERE max_stage < 6)
        )
        FROM guest_onboarding_funnel WHERE signed_up_at IS NOT NULL
    ));
END;
$$;

REVOKE EXECUTE ON FUNCTION guest_onboarding_funnel_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION guest_onboarding_funnel_stats() FROM anon;
GRANT  EXECUTE ON FUNCTION guest_onboarding_funnel_stats() TO authenticated;

COMMIT;
