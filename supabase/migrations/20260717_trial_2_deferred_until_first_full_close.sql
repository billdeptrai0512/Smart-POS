-- ============================================================
-- Trial KHÔNG cấp lúc tạo địa chỉ nữa — chỉ cấp (và bắt đầu đếm 7 ngày) ở lần
-- CHỐT CA FULL đầu tiên. Trước đó: địa chỉ dùng full tính năng, KHÔNG đếm ngược
-- gì cả — 2026-07-17
--
-- Lý do (theo yêu cầu chủ sản phẩm): mục tiêu là owner phải THỰC SỰ vận hành đủ
-- (thực thu + kiểm kho) trước khi bắt đầu tính phí. Chưa vận hành đủ thì không có
-- lý do gì bắt đầu đếm ngược — kể cả trong lúc setup kéo dài bao lâu.
--
-- ⚠️ Đánh đổi đã cân nhắc: nếu 1 địa chỉ (đúng 1 địa chỉ / SĐT, do trial_grants
-- chặn) không bao giờ chốt ca full, địa chỉ đó mở khoá báo cáo miễn phí VÔ THỜI
-- HẠN. Chấp nhận có chủ đích — không giới hạn trần thời gian (đã trao đổi & xác
-- nhận). KHÔNG áp dụng cho địa chỉ #2 trở đi của cùng SĐT (trial_grants vẫn 1
-- SĐT = 1 trial trọn đời — địa chỉ #2 không có bypass, xem get_address_entitlement).
--
-- Thay đổi:
--   1. Bỏ cấp trial lúc tạo địa chỉ (drop trigger + function
--      grant_trial_on_address_creation — không còn dùng).
--   2. set_my_phone(): bỏ nhánh cấp trial ngay khi nhập SĐT lần đầu (case cũ 'c').
--      Giữ nguyên chuẩn hoá SĐT + copy "vết đốt" khi đổi số (vẫn cần).
--   3. Trigger shift_closings đổi tên + mở rộng: grant_trial_on_first_full_shift_close
--      — ca FULL đầu tiên của địa chỉ (chưa từng có sub nào) sẽ TẠO MỚI row trial
--      (valid_from/to = ngày chốt .. +7), thay vì chỉ "neo lại" 1 row có sẵn.
--      Địa chỉ ĐÃ có sub từ trước (data cũ, tạo bởi cơ chế cũ) vẫn chỉ reanchor
--      1 lần như migration 20260717_trial_1_reanchor_requires_full_close.sql.
--   4. get_address_entitlement(): đổi SECURITY INVOKER → DEFINER (cần đọc
--      trial_grants — RLS bảng đó là `USING (false)`, chặn mọi SELECT trực tiếp).
--      Thêm ownership guard (bắt buộc vì giờ bypass RLS) + nhánh bypass: địa chỉ
--      CHƯA từng có sub nào VÀ SĐT chủ quán CHƯA từng dùng trial → trả 'all' tạm
--      (free, không đếm ngược) cho tới khi có ca full đầu tiên.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

-- ── 1. Bỏ cấp trial lúc tạo địa chỉ ────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_grant_trial_on_address_creation ON addresses;
DROP FUNCTION IF EXISTS grant_trial_on_address_creation();

-- ── 2. set_my_phone(): bỏ nhánh cấp trial ngay khi nhập SĐT lần đầu ───────────
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
BEGIN
    v_phone := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
    IF v_phone ~ '^00' THEN
        v_phone := substr(v_phone, 3);
    END IF;
    IF v_phone ~ '^840\d{9}$' THEN
        v_phone := substr(v_phone, 3);
    ELSIF v_phone ~ '^84\d{9}$' THEN
        v_phone := '0' || substr(v_phone, 3);
    END IF;
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

    -- Đổi số (đã có phone trước đó): nếu account ĐÃ tiêu trial — copy vết đốt
    -- sang số MỚI, chống đổi-số-để-mở-lại-trial. Không đụng gì khác.
    IF v_user.phone IS NOT NULL THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        SELECT v_phone, address_id, expires_at FROM (
            SELECT address_id, expires_at
              FROM trial_grants WHERE phone = v_user.phone
            UNION ALL
            SELECT s.address_id, s.valid_to::timestamptz
              FROM address_subscriptions s
              JOIN addresses a ON a.id = s.address_id
             WHERE a.manager_id = v_user.id AND s.note = 'trial'
        ) src
        LIMIT 1
        ON CONFLICT (phone) DO NOTHING;
        RETURN 'ok';
    END IF;

    -- Lần đầu nhập SĐT: chỉ bind lịch sử nếu account đã từng có trial cấp theo
    -- cơ chế CŨ (trước 2026-07-17, trial cấp lúc tạo địa chỉ). Không cấp trial
    -- mới ở đây nữa — trial (nếu còn) sẽ được cấp ở lần chốt ca FULL đầu tiên,
    -- xem trigger grant_trial_on_first_full_shift_close trên shift_closings.
    IF EXISTS (SELECT 1 FROM trial_grants WHERE phone = v_phone) THEN
        RETURN 'ok';  -- SĐT đã từng nhận trial
    END IF;

    SELECT s.address_id, s.valid_to INTO v_trial_addr, v_trial_to
      FROM address_subscriptions s
      JOIN addresses a ON a.id = s.address_id
     WHERE a.manager_id = v_user.id AND s.note = 'trial'
     LIMIT 1;
    IF FOUND THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, v_trial_addr, v_trial_to::timestamptz)
        ON CONFLICT (phone) DO NOTHING;
    END IF;

    RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_phone(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_phone(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_my_phone(TEXT) TO authenticated;

-- ── 3. Trigger shift_closings: tạo trial (lần đầu) HOẶC reanchor (data cũ) ────
CREATE OR REPLACE FUNCTION grant_trial_on_first_full_shift_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_missing    INT;
    v_phone      TEXT;
    v_close_date DATE;
BEGIN
    IF NEW.cash_closed_at IS NULL THEN
        RETURN NEW;  -- chưa lưu thực thu → chắc chắn chưa full
    END IF;

    -- Chỉ tính nguyên liệu count_in_audit != false — khớp đúng danh sách UI cho
    -- staff đếm (client lọc y hệt: fetchIngredientCostsWithUnits().filter(r =>
    -- r.count_in_audit !== false), xem useShiftInventoryState.js). Thiếu filter
    -- này sẽ bắt phải đếm cả nguyên liệu bị tắt "kiểm kê hao hụt" — thứ UI còn
    -- không hiển thị cho user nhập, khiến "full" không bao giờ đạt được.
    SELECT COUNT(*) INTO v_missing
    FROM (
        SELECT DISTINCT ingredient FROM ingredient_costs
        WHERE address_id = NEW.address_id AND count_in_audit IS DISTINCT FROM false
    ) ic
    WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.inventory_report, '[]'::jsonb)) elem
        WHERE (elem->>'ingredient') = ic.ingredient
          AND elem->>'remaining' IS NOT NULL
    );
    IF v_missing > 0 THEN
        RETURN NEW;  -- kiểm kho chưa đủ → chưa full
    END IF;

    v_close_date := vn_business_date(NEW.closed_at);

    -- Data cũ: địa chỉ đã có sub (trial cấp lúc tạo theo cơ chế trước
    -- 2026-07-17, hoặc đã paid) → chỉ reanchor 1 lần, không tạo thêm.
    IF EXISTS (SELECT 1 FROM address_subscriptions WHERE address_id = NEW.address_id) THEN
        UPDATE address_subscriptions
           SET valid_to = GREATEST(valid_to, v_close_date + 7),
               trial_reanchored_at = COALESCE(trial_reanchored_at, now())
         WHERE address_id = NEW.address_id
           AND note = 'trial'
           AND trial_reanchored_at IS NULL;
        RETURN NEW;
    END IF;

    -- Địa chỉ CHƯA từng có sub nào — ca full này chính là mốc trial THẬT SỰ bắt
    -- đầu (trước đó địa chỉ đang free tạm nhờ bypass trong get_address_entitlement).
    -- Chỉ cấp nếu owner có SĐT và SĐT đó CHƯA từng dùng trial ở địa chỉ khác.
    SELECT u.phone INTO v_phone
    FROM addresses a JOIN users u ON u.id = a.manager_id
    WHERE a.id = NEW.address_id;

    IF v_phone IS NULL OR EXISTS (SELECT 1 FROM trial_grants WHERE phone = v_phone) THEN
        RETURN NEW;  -- chưa có SĐT, hoặc SĐT đã dùng trial ở địa chỉ khác
    END IF;

    INSERT INTO address_subscriptions
        (address_id, tier, valid_from, valid_to, amount_paid, note, trial_reanchored_at)
    VALUES
        (NEW.address_id, 'all', v_close_date, v_close_date + 7, 0, 'trial', now());

    INSERT INTO trial_grants (phone, address_id, expires_at)
    VALUES (v_phone, NEW.address_id, (v_close_date + 7)::timestamptz)
    ON CONFLICT (phone) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_trial_on_first_full_shift_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reanchor_trial_on_first_shift_close ON shift_closings;
DROP FUNCTION IF EXISTS reanchor_trial_on_first_shift_close();

CREATE TRIGGER trg_grant_trial_on_first_full_shift_close
AFTER INSERT OR UPDATE ON shift_closings
FOR EACH ROW
WHEN (NEW.cash_closed_at IS NOT NULL)
EXECUTE FUNCTION grant_trial_on_first_full_shift_close();

-- ── 4. get_address_entitlement(): DEFINER + bypass "chưa full-close lần nào" ──
CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone TEXT;
BEGIN
    -- Ownership guard bắt buộc (đổi INVOKER → DEFINER để đọc được trial_grants,
    -- RLS bảng đó là `USING (false)`). Skip khi auth.uid() IS NULL (service_role/
    -- cron) — vì vậy REVOKE EXECUTE khỏi anon bên dưới là bắt buộc, nếu không anon
    -- gọi với auth.uid()=NULL sẽ né được guard này.
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

    IF EXISTS (
        SELECT 1 FROM address_subscriptions s
        WHERE s.address_id = p_address_id
          AND s.valid_from <= CURRENT_DATE AND s.valid_to >= CURRENT_DATE
    ) THEN
        RETURN QUERY
        SELECT s.tier, MAX(s.valid_to)
        FROM address_subscriptions s
        WHERE s.address_id = p_address_id
          AND s.valid_from <= CURRENT_DATE AND s.valid_to >= CURRENT_DATE
        GROUP BY s.tier;
        RETURN;
    END IF;

    -- Không có sub active. Địa chỉ CHƯA từng có sub nào (chưa full-close lần nào,
    -- trial thật chưa cấp) VÀ SĐT chủ quán CHƯA từng dùng trial ở địa chỉ khác →
    -- free full access tạm, không đếm ngược, cho tới ca full đầu tiên.
    IF NOT EXISTS (SELECT 1 FROM address_subscriptions WHERE address_id = p_address_id) THEN
        SELECT u.phone INTO v_phone
        FROM addresses a JOIN users u ON u.id = a.manager_id
        WHERE a.id = p_address_id;

        IF v_phone IS NULL OR NOT EXISTS (SELECT 1 FROM trial_grants WHERE phone = v_phone) THEN
            RETURN QUERY SELECT 'all'::TEXT, '2099-12-31'::DATE;
        END IF;
    END IF;

    RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_address_entitlement(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_address_entitlement(UUID) TO authenticated;
