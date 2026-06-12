-- ==============================================================================================
-- 20260612_security_advisor_fixes.sql — đợt 4 dọn Security Advisor (sau 20260505/20260520/20260603)
--
-- Nguyên nhân quen thuộc (xem 20260603_fix_security_advisor_part3): CREATE OR REPLACE FUNCTION
-- làm RƠI `SET search_path` và (với signature MỚI) cấp EXECUTE mặc định cho PUBLIC.
-- Các migration 20260609–20260612 tái tạo hàm và dính lại đúng các lỗi đó:
--
-- 1. [0011 search_path] get_daily_report_context / get_report_by_date / get_report_by_range
--    — bị recreate ở 20260612_invoice_payment_cash_phase không kèm SET search_path.
--    → ALTER FUNCTION. Không đổi behavior.
--
-- 2. [0028 anon executable]
--    - record_invoice_payment (signature 6 tham số MỚI ở 20260612 → PUBLIC default) → revoke.
--    - grant_trial_on_address_creation (recreate ở 20260609/20260611) → trigger-only,
--      không ai cần gọi qua /rest/v1/rpc → revoke cả PUBLIC + anon + authenticated
--      (trigger vẫn chạy bình thường — trigger firing không check EXECUTE).
--
-- 3. [LỖ HỔNG THẬT — advisor chỉ gián tiếp chỉ ra] 2 hàm SECURITY DEFINER GHI dữ liệu
--    KHÔNG có ownership guard → user đăng nhập bất kỳ (tự đăng ký được!) biết UUID là
--    ghi được vào dữ liệu quán người khác:
--    - process_ingredient_restock: guard từng có ở 20260520 nhưng MẤT khi recreate
--      (20260527→20260602). Re-create body 20260602 + guard.
--    - record_invoice_payment: chưa từng có guard (comment "RLS sẽ chặn" là SAI —
--      SECURITY DEFINER bypass RLS). Re-create body 20260612 + guard.
--    Guard theo đúng pattern 20260520: admin OR chủ địa chỉ OR user_address_access;
--    skip khi auth.uid() IS NULL (service_role/migration).
--
-- CÒN LẠI TRONG ADVISOR = CHỦ ĐÍCH, KHÔNG SỬA (như part3 đã kết luận):
--    - RLS helpers (is_admin_auth, is_manager_auth, auth_owner_id, can_write_address):
--      policy + client cần gọi.
--    - admin_* : đã guard is_admin_auth bên trong.
--    - set_my_phone: tự scope theo auth.uid().
--    - Các RPC đọc/ghi còn lại: đã có guard riêng bên trong (đã verify từng hàm).
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

-- ── 1. search_path cho 3 report RPC ───────────────────────────────────────────
ALTER FUNCTION public.get_daily_report_context(uuid) SET search_path = public;
ALTER FUNCTION public.get_report_by_date(uuid, date) SET search_path = public;
ALTER FUNCTION public.get_report_by_range(uuid, timestamptz, timestamptz, timestamptz, timestamptz) SET search_path = public;

-- ── 2. grant_trial_on_address_creation: trigger-only ──────────────────────────
REVOKE EXECUTE ON FUNCTION public.grant_trial_on_address_creation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_trial_on_address_creation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_trial_on_address_creation() FROM authenticated;

-- ── 3a. record_invoice_payment: + ownership guard, revoke anon ────────────────
-- Body = 20260612_invoice_payment_cash_phase + khối guard sau khi resolve address.
CREATE OR REPLACE FUNCTION record_invoice_payment(
    p_expense_id     UUID,
    p_amount         NUMERIC,
    p_payment_method TEXT DEFAULT 'cash',
    p_staff_name     TEXT DEFAULT NULL,
    p_paid_at        TIMESTAMPTZ DEFAULT NULL,
    p_cash_phase     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_id      UUID;
    v_invoice_amount  NUMERIC;
    v_invoice_created TIMESTAMPTZ;
    v_paid_total      NUMERIC;
    v_paid_at         TIMESTAMPTZ;
    v_cash_phase      TEXT;
    v_payment_id      UUID;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount must be > 0';
    END IF;

    -- NULL = không phân loại (phiếu cũ / caller cũ) → report fallback cờ hoá đơn.
    v_cash_phase := NULLIF(p_cash_phase, '');
    IF v_cash_phase IS NOT NULL AND v_cash_phase NOT IN ('in_shift', 'post_close') THEN
        RAISE EXCEPTION 'cash_phase must be in_shift | post_close (got %)', v_cash_phase;
    END IF;

    SELECT address_id, amount, created_at
    INTO v_address_id, v_invoice_amount, v_invoice_created
    FROM expenses
    WHERE id = p_expense_id AND is_refill = true;

    IF v_address_id IS NULL THEN
        RAISE EXCEPTION 'invoice not found or not a refill';
    END IF;

    -- Ownership guard (SECURITY DEFINER bypass RLS nên phải tự check):
    -- admin / chủ địa chỉ / thành viên qua user_address_access.
    -- Skip khi auth.uid() IS NULL (service_role / migration).
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = v_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', v_address_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_paid_at := COALESCE(p_paid_at, NOW());

    -- Chặn backdate sang trước NGÀY nhập (so theo ngày VN — client neo 12h trưa).
    IF (v_paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         < (v_invoice_created AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before invoice date (%)',
            v_paid_at, (v_invoice_created AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
    END IF;

    -- Chặn overpay.
    SELECT COALESCE(SUM(amount), 0) INTO v_paid_total
    FROM expense_payments WHERE expense_id = p_expense_id;

    IF v_paid_total + p_amount > v_invoice_amount THEN
        RAISE EXCEPTION 'overpay: paid_total (% + %) would exceed invoice amount (%)',
            v_paid_total, p_amount, v_invoice_amount;
    END IF;

    INSERT INTO expense_payments (
        expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at, cash_phase
    ) VALUES (
        p_expense_id,
        v_address_id,
        p_amount,
        COALESCE(p_payment_method, 'cash'),
        p_staff_name,
        v_paid_at,
        v_paid_at,
        v_cash_phase
    ) RETURNING id INTO v_payment_id;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- ── 3b. process_ingredient_restock: guard bị mất khi recreate — gắn lại ───────
-- Body = 20260602_restock_cash_phase + khối guard (nguyên văn pattern 20260520).
CREATE OR REPLACE FUNCTION process_ingredient_restock(
    p_address_id    UUID,
    p_ingredient    TEXT,
    p_qty           NUMERIC,
    p_subtotal      NUMERIC,
    p_staff_name    TEXT,
    p_created_at    TIMESTAMPTZ DEFAULT NULL,
    p_discount      NUMERIC DEFAULT 0,
    p_extra_cost    NUMERIC DEFAULT 0,
    p_initial_payment NUMERIC DEFAULT NULL,
    p_payment_method TEXT DEFAULT 'cash',
    p_paid_at       TIMESTAMPTZ DEFAULT NULL,
    p_cash_phase    TEXT DEFAULT 'post_close'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_stock NUMERIC;
    v_old_unit_cost NUMERIC;
    v_new_unit_cost NUMERIC;
    v_expense_id    UUID;
    v_payment_id    UUID;
    v_display_name  TEXT;
    v_amount        NUMERIC;
    v_paid          NUMERIC;
    v_created_at    TIMESTAMPTZ;
    v_paid_at       TIMESTAMPTZ;
    v_before_stock  NUMERIC;
    v_after_stock   NUMERIC;
BEGIN
    -- Ownership guard: admin / chủ địa chỉ / thành viên (staff restock được).
    -- Skip khi auth.uid() IS NULL (service_role / migration). Guard này từng có ở
    -- 20260520 và bị rơi khi recreate — đừng để mất lần nữa.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = p_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', p_address_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF COALESCE(p_discount, 0) < 0 THEN
        RAISE EXCEPTION 'discount cannot be negative (got %)', p_discount;
    END IF;
    IF COALESCE(p_extra_cost, 0) < 0 THEN
        RAISE EXCEPTION 'extra_cost cannot be negative (got %)', p_extra_cost;
    END IF;
    v_amount     := COALESCE(p_subtotal, 0) - COALESCE(p_discount, 0) + COALESCE(p_extra_cost, 0);
    IF v_amount < 0 THEN v_amount := 0; END IF;
    v_paid       := COALESCE(p_initial_payment, v_amount);
    IF v_paid < 0 THEN v_paid := 0; END IF;
    IF v_paid > v_amount THEN v_paid := v_amount; END IF;
    v_created_at := COALESCE(p_created_at, NOW());
    -- Payment instant defaults to the (possibly backdated) created_at, so a backdated
    -- restock keeps paid_at and created_at on the SAME past day — satisfying the
    -- expense_payments check constraint instead of pinning created_at to NOW().
    v_paid_at    := COALESCE(p_paid_at, v_created_at);
    IF v_paid_at < v_created_at - interval '1 minute' THEN
        RAISE EXCEPTION 'paid_at (%) cannot be before created_at (%)', v_paid_at, v_created_at;
    END IF;

    -- 1. Tồn hiện tại (counter remaining từ shift_closing gần nhất).
    SELECT COALESCE(
        (SELECT (elem->>'remaining')::NUMERIC
         FROM jsonb_array_elements(inventory_report) AS elem
         WHERE (elem->>'ingredient')::TEXT = p_ingredient
         LIMIT 1),
        0
    )
    INTO v_current_stock
    FROM shift_closings
    WHERE address_id = p_address_id AND inventory_report IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_current_stock IS NULL OR v_current_stock < 0 THEN v_current_stock := 0; END IF;

    -- Snapshot warehouse-side. The RPC's v_current_stock above is the COUNTER
    -- (latest shift_closing remaining). For Nhật ký's "Tồn X → Y" we want the
    -- WAREHOUSE balance, which is Σ refills − Σ restocks-to-counter on or after
    -- the first refill. Use the same recipe fetchIngredientStocks does.
    WITH refills AS (
        SELECT created_at, COALESCE((metadata->>'qty')::NUMERIC, 0) AS qty
        FROM expenses
        WHERE address_id = p_address_id
          AND is_refill = true
          AND metadata->>'ingredient' = p_ingredient
    ),
    first_refill AS (
        SELECT MIN(created_at) AS first_at FROM refills WHERE qty IS NOT NULL
    ),
    restocks AS (
        SELECT COALESCE((elem->>'restock')::NUMERIC, 0) AS qty
        FROM shift_closings sc, jsonb_array_elements(sc.inventory_report) AS elem
        WHERE sc.address_id = p_address_id
          AND sc.inventory_report IS NOT NULL
          AND (elem->>'ingredient')::TEXT = p_ingredient
          AND sc.created_at >= (SELECT first_at FROM first_refill)
    )
    SELECT ROUND(GREATEST(
        0,
        COALESCE((SELECT SUM(qty) FROM refills), 0)
            - COALESCE((SELECT SUM(qty) FROM restocks), 0)
    )::numeric, 1)
    INTO v_before_stock;

    v_after_stock := ROUND(v_before_stock + COALESCE(p_qty, 0), 1);

    -- 2. Giá vốn hiện tại
    SELECT COALESCE(unit_cost, 0)
    INTO v_old_unit_cost
    FROM ingredient_costs
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    IF v_old_unit_cost IS NULL THEN v_old_unit_cost := 0; END IF;

    -- 3. WAC dùng v_amount
    IF (v_current_stock + p_qty) > 0 THEN
        v_new_unit_cost := ROUND(((v_current_stock * v_old_unit_cost) + v_amount) / (v_current_stock + p_qty));
    ELSE
        v_new_unit_cost := v_old_unit_cost;
    END IF;

    UPDATE ingredient_costs
    SET unit_cost = v_new_unit_cost
    WHERE address_id = p_address_id AND ingredient = p_ingredient;

    v_display_name := INITCAP(REPLACE(p_ingredient, '_', ' '));

    INSERT INTO expenses (
        address_id, name, amount, is_fixed, is_refill, payment_method,
        staff_name, metadata, discount_amount, extra_cost, created_at
    ) VALUES (
        p_address_id,
        v_display_name,
        v_amount,
        false,
        true,
        p_payment_method,
        p_staff_name,
        jsonb_build_object(
            'ingredient',    p_ingredient,
            'qty',           p_qty,
            'subtotal',      p_subtotal,
            'old_unit_cost', v_old_unit_cost,
            'new_unit_cost', v_new_unit_cost,
            'before_stock',  v_before_stock,
            'after_stock',   v_after_stock,
            'cash_phase',    COALESCE(NULLIF(p_cash_phase, ''), 'post_close')
        ),
        COALESCE(p_discount, 0),
        COALESCE(p_extra_cost, 0),
        v_created_at
    ) RETURNING id INTO v_expense_id;

    IF v_paid > 0 THEN
        -- created_at backdated alongside paid_at so the past-purchase payment row
        -- satisfies chk_payment_paid_at_not_before_created.
        INSERT INTO expense_payments (
            expense_id, address_id, amount, payment_method, staff_name, paid_at, created_at
        ) VALUES (
            v_expense_id,
            p_address_id,
            v_paid,
            COALESCE(p_payment_method, 'cash'),
            p_staff_name,
            v_paid_at,
            v_paid_at
        ) RETURNING id INTO v_payment_id;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'expense_id',    v_expense_id,
        'payment_id',    v_payment_id,
        'amount',        v_amount,
        'paid',          v_paid,
        'owing',         v_amount - v_paid,
        'old_unit_cost', v_old_unit_cost,
        'new_unit_cost', v_new_unit_cost,
        'before_stock',  v_before_stock,
        'after_stock',   v_after_stock
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.process_ingredient_restock(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

COMMIT;
