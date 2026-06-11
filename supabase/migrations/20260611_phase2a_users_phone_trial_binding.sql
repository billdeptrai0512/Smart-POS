-- ============================================================
-- Phase 2A — Thu SĐT + bind trial vào SĐT (task.md Giai đoạn A) — 2026-06-11
--
--   1. users.phone (chuẩn hoá +84, UNIQUE khi không NULL).
--   2. RPC set_my_phone(p_phone): chuẩn hoá + lưu SĐT cho tài khoản đang đăng nhập.
--      LẦN ĐẦU nhập số → xử lý trial:
--        a. phone đã có trong trial_grants → không cấp (1 SĐT = 1 trial trọn đời)
--        b. account đã có address từng nhận trial (note='trial') → chỉ ghi trial_grants
--           (bind lịch sử — trial cũ cấp theo account, giờ khoá vào SĐT)
--        c. có address chưa từng có gói 'all' → cấp trial 7 ngày cho address đó
--        d. chưa có address nào → không làm gì, trigger sẽ cấp khi tạo address đầu
--      Đổi số (phone cũ ≠ NULL) → chỉ update số, KHÔNG đụng trial.
--   3. Trigger grant_trial_on_address_creation (viết lại): CHỈ cấp trial khi owner
--      ĐÃ CÓ phone và phone chưa có trong trial_grants. Bỏ check "address đầu tiên"
--      (trial_grants giờ là nguồn chân lý 1-SĐT-1-trial).
--
-- Vá 2 lỗ trial: tạo tài khoản mới nhận trial lại + xoá address tạo lại nhận trial lại.
-- ⚠️ Behavior mới: account KHÔNG có phone → tạo address KHÔNG có trial (mồi nhập SĐT).
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

-- ── 1. users.phone ─────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
    ON users(phone) WHERE phone IS NOT NULL;

-- ── 2. RPC set_my_phone ────────────────────────────────────────────────────────
-- SECURITY DEFINER: cần ghi address_subscriptions + trial_grants (bảng chỉ RLS SELECT).
-- Trả: 'trial_granted' (vừa cấp 7 ngày) | 'ok' (mọi trường hợp còn lại).
CREATE OR REPLACE FUNCTION set_my_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone      TEXT;
    v_user       users%ROWTYPE;
    v_trial_addr UUID;
    v_trial_to   DATE;
    v_addr       UUID;
BEGIN
    -- Chuẩn hoá về E.164 +84xxxxxxxxx (kiểu libphonenumber, region VN):
    -- mọi biến thể của CÙNG 1 số phải ra CÙNG 1 chuỗi → unique index/trial_grants
    -- so trùng chính xác, không thể lách trial bằng cách đổi cách viết.
    v_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');  -- chỉ giữ digits
    IF v_phone ~ '^00' THEN                       -- tiền tố quay quốc tế: 0084...
        v_phone := substr(v_phone, 3);
    END IF;
    IF v_phone ~ '^840\d{9}$' THEN                -- +84 0902... (thừa số 0 sau mã nước)
        v_phone := substr(v_phone, 3);            -- → 0902...
    ELSIF v_phone ~ '^84\d{9}$' THEN              -- 84902... / +84902...
        v_phone := '0' || substr(v_phone, 3);     -- → 0902...
    END IF;
    -- Sau chuẩn hoá phải là di động VN 10 số: 0 + đầu số 3/5/7/8/9 + 8 số.
    IF v_phone !~ '^0[35789]\d{8}$' THEN
        RAISE EXCEPTION 'Số điện thoại không hợp lệ — cần số di động VN 10 số (vd: 0902822192)';
    END IF;
    v_phone := '+84' || substr(v_phone, 2);

    SELECT * INTO v_user FROM users WHERE auth_id = auth.uid();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy tài khoản';
    END IF;
    IF v_user.phone = v_phone THEN
        RETURN 'ok';  -- không đổi gì
    END IF;

    IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone AND id <> v_user.id) THEN
        RAISE EXCEPTION 'Số điện thoại đã được dùng cho tài khoản khác';
    END IF;

    UPDATE users SET phone = v_phone WHERE id = v_user.id;

    -- Đổi số (đã có phone trước đó) → không đụng trial.
    IF v_user.phone IS NOT NULL THEN
        RETURN 'ok';
    END IF;

    -- (a) SĐT đã từng nhận trial → thôi.
    IF EXISTS (SELECT 1 FROM trial_grants WHERE phone = v_phone) THEN
        RETURN 'ok';
    END IF;

    -- (b) Account đã từng nhận trial (cấp theo account trước đây) → bind vào SĐT.
    SELECT s.address_id, s.valid_to INTO v_trial_addr, v_trial_to
      FROM address_subscriptions s
      JOIN addresses a ON a.id = s.address_id
     WHERE a.manager_id = v_user.id AND s.note = 'trial'
     LIMIT 1;
    IF FOUND THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, v_trial_addr, v_trial_to::timestamptz)
        ON CONFLICT (phone) DO NOTHING;
        RETURN 'ok';
    END IF;

    -- (c) Có address chưa từng có gói 'all' → cấp trial 7 ngày.
    SELECT a.id INTO v_addr
      FROM addresses a
     WHERE a.manager_id = v_user.id
       AND NOT EXISTS (
            SELECT 1 FROM address_subscriptions s
            WHERE s.address_id = a.id AND s.tier = 'all'
       )
     LIMIT 1;
    IF FOUND THEN
        INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
        VALUES (v_addr, 'all', CURRENT_DATE, CURRENT_DATE + 7, 0, 'trial');
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, v_addr, now() + interval '7 days')
        ON CONFLICT (phone) DO NOTHING;
        RETURN 'trial_granted';
    END IF;

    -- (d) Chưa có address → trigger lo khi tạo address đầu tiên.
    RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_phone(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_phone(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_my_phone(TEXT) TO authenticated;

-- ── 3. Trigger trial: cấp theo SĐT, không theo "address đầu tiên" ──────────────
-- Trigger trg_grant_trial_on_address_creation (AFTER INSERT ON addresses) đã tồn
-- tại từ 20260512 — chỉ cần thay thân function.
CREATE OR REPLACE FUNCTION grant_trial_on_address_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
BEGIN
    SELECT phone INTO v_phone FROM users WHERE id = NEW.manager_id;

    -- Chưa nhập SĐT → không trial (UI mồi nhập SĐT lúc tạo chi nhánh đầu tiên).
    IF v_phone IS NULL THEN
        RETURN NEW;
    END IF;

    -- 1 SĐT = 1 trial trọn đời.
    IF EXISTS (SELECT 1 FROM trial_grants WHERE phone = v_phone) THEN
        RETURN NEW;
    END IF;

    INSERT INTO address_subscriptions (address_id, tier, valid_from, valid_to, amount_paid, note)
    VALUES (NEW.id, 'all', CURRENT_DATE, CURRENT_DATE + 7, 0, 'trial');

    INSERT INTO trial_grants (phone, address_id, expires_at)
    VALUES (v_phone, NEW.id, now() + interval '7 days');

    RETURN NEW;
END;
$$;
