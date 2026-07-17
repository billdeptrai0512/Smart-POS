-- ============================================================
-- Bỏ giới hạn "1 SĐT = 1 trial trọn đời" cho cơ chế trial-deferred-tới-full-close
-- — mỗi ĐỊA CHỈ có vòng đời trial độc lập (free tới ca full đầu tiên → 7 ngày →
-- paywall), không quan tâm account/SĐT đã có địa chỉ khác dùng trial chưa —
-- 2026-07-17
--
-- Quyết định (đã trao đổi & xác nhận): đơn giản hoá cho owner setup nhiều chi
-- nhánh — mỗi chi nhánh mới đều được hưởng đủ 1 vòng free-tới-full-close + 7
-- ngày, khớp với mô hình tính phí vốn đã theo TỪNG address_id (§1 MONETIZATION.md
-- — "mỗi xe 1 gói riêng"), không có lý do gì trial lại giới hạn theo SĐT trong
-- khi billing không giới hạn.
--
-- ⚠️ Rủi ro đã cân nhắc & CHẤP NHẬN: xoá 1 địa chỉ rồi tạo lại (cùng SĐT) sẽ được
-- 1 vòng trial mới — lỗ hổng mà 20260622 từng vá cho mô hình CŨ. Chấp nhận vì
-- lặp lại thao tác này vô nghĩa với 1 quán thật: mỗi lần phải xoá sạch dữ liệu
-- bán hàng + giả vờ chốt ca full lại từ đầu — friction thật, không phải kẽ hở
-- miễn phí.
--
-- Thay đổi:
--   1. get_address_entitlement(): bỏ check trial_grants trong nhánh bypass —
--      CHỈ còn điều kiện "địa chỉ chưa từng có sub nào" (không cần biết SĐT).
--   2. grant_trial_on_first_full_shift_close(): bỏ check "SĐT đã dùng trial ở
--      địa chỉ khác" — chỉ còn yêu cầu owner đã nhập SĐT (giữ nguyên, không phải
--      anti-abuse, chỉ là tiền đề UX cũ "mồi nhập SĐT").
--   3. trial_grants: KHÔNG xoá bảng/logic set_my_phone (vẫn hữu ích cho dữ liệu
--      lịch sử + insert vẫn chạy để giữ 1 bản ghi/SĐT cho mục đích tham khảo/
--      admin, dù không còn dùng để gate).
--
-- IDEMPOTENT — chạy lại an toàn.
-- ============================================================

-- ── 1. Trigger: bỏ check "SĐT đã dùng trial ở địa chỉ khác" ───────────────────
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

    -- Chỉ tính nguyên liệu count_in_audit != false (khớp UI, xem
    -- useShiftInventoryState.js) — nguyên liệu tắt "kiểm kê hao hụt" UI không
    -- hiển thị để nhập, không thể bắt phải đếm.
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

    -- Địa chỉ CHƯA từng có sub nào — ca full này chính là mốc trial bắt đầu.
    -- Chỉ cần owner đã nhập SĐT (mồi UX cũ, KHÔNG còn check "đã dùng trial ở
    -- địa chỉ khác" — mỗi địa chỉ độc lập, xem đầu file).
    SELECT u.phone INTO v_phone
    FROM addresses a JOIN users u ON u.id = a.manager_id
    WHERE a.id = NEW.address_id;

    IF v_phone IS NULL THEN
        RETURN NEW;  -- chưa có SĐT — chưa cấp, chờ owner nhập SĐT
    END IF;

    INSERT INTO address_subscriptions
        (address_id, tier, valid_from, valid_to, amount_paid, note, trial_reanchored_at)
    VALUES
        (NEW.address_id, 'all', v_close_date, v_close_date + 7, 0, 'trial', now());

    -- Vẫn ghi trial_grants cho mục đích lịch sử/tham khảo (KHÔNG dùng để gate
    -- nữa) — ON CONFLICT DO NOTHING vì phone là PK, chỉ giữ được bản ghi đầu
    -- tiên/SĐT; các địa chỉ sau của cùng SĐT không ghi thêm được, chấp nhận.
    INSERT INTO trial_grants (phone, address_id, expires_at)
    VALUES (v_phone, NEW.address_id, (v_close_date + 7)::timestamptz)
    ON CONFLICT (phone) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_trial_on_first_full_shift_close() FROM PUBLIC, anon, authenticated;

-- ── 2. get_address_entitlement(): bypass không còn cần biết SĐT ──────────────
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

    -- Không có sub active. Địa chỉ CHƯA từng có sub nào (chưa full-close lần
    -- nào) → free full access tạm, không đếm ngược, cho tới ca full đầu tiên.
    -- KHÔNG còn check SĐT — mỗi địa chỉ độc lập (xem đầu file).
    IF NOT EXISTS (SELECT 1 FROM address_subscriptions WHERE address_id = p_address_id) THEN
        RETURN QUERY SELECT 'all'::TEXT, '2099-12-31'::DATE;
    END IF;

    RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_address_entitlement(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_address_entitlement(UUID) TO authenticated;

-- ── 3. Bỏ hẳn list_pending_trial_addresses() (từ 20260717_trial_3_...sql) ────
-- RPC đó tồn tại chỉ để phân biệt "0 row vì đang free tạm" với "0 row vì SĐT đã
-- cháy trial ở địa chỉ khác". Giờ bypass KHÔNG còn check SĐT (§1/§2 ở trên) →
-- "0 row address_subscriptions" LUÔN LUÔN nghĩa là đang free tạm, không còn case
-- nào khác → client tự suy ra được từ rowsMap đã có sẵn (fetchSubscriptionStatuses),
-- không cần RPC riêng nữa. Drop cho khỏi để lại code chết.
DROP FUNCTION IF EXISTS list_pending_trial_addresses(UUID[]);
