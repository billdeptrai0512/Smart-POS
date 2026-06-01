-- ==============================================================================================
-- cancel_restock: hủy một phiếu nhập kho HOẶC phiếu hiệu chỉnh tồn — GIỮ dòng trong nhật ký,
-- chỉ đánh dấu "đã hủy" (giống xóa order trong /history), và hoàn lại hiện trạng.
--
-- Thay vì xóa dòng, ta ZERO-OUT tại chỗ:
--   • metadata.qty → 0, amount → 0  ⇒ dòng trở nên trung tính với MỌI aggregator tồn kho /
--     dòng tiền (chúng sum qty + amount over is_refill rows). Không phải sửa RPC/JS nào khác.
--   • Số liệu gốc cất vào metadata.cancelled_qty / .cancelled_amount để thẻ vẫn hiển thị
--     "+454 g / -35.000đ" (gạch ngang) và badge ĐÃ HỦY.
--   • cancelled=true, cancelled_at, cancelled_by → cờ hiển thị + audit.
--   • expense_payments của phiếu bị xóa (đảo cash-out của phiếu đã trả).
--   • Giá vốn (WAC) tính lại từ các phiếu mua thật còn lại.
--
-- Không thể hủy một dòng đã hủy (idempotent guard). Adjustments cũng hủy được; chúng amount=0
-- nên chỉ có qty bị zero (đảo tồn) — WAC không đổi vì recompute loại adjustment.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION cancel_restock(
    p_address_id UUID,
    p_expense_id UUID,
    p_staff_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ingredient    TEXT;
    v_qty           NUMERIC;
    v_amount        NUMERIC;
    v_meta          JSONB;
    v_is_refill     BOOLEAN;
    v_is_adjustment BOOLEAN;
    v_already       BOOLEAN;
    v_total_qty     NUMERIC;
    v_total_cost    NUMERIC;
    v_new_unit_cost NUMERIC;
BEGIN
    IF p_address_id IS NULL OR p_expense_id IS NULL THEN
        RAISE EXCEPTION 'p_address_id and p_expense_id are required';
    END IF;

    -- Ownership guard (mirrors process_ingredient_restock). Skip for service_role/migrations.
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

    -- Load + validate. Lock the row so a concurrent cancel can't double-process.
    SELECT (metadata->>'ingredient')::TEXT,
           COALESCE((metadata->>'qty')::NUMERIC, 0),
           amount,
           metadata,
           is_refill,
           COALESCE((metadata->>'adjustment')::BOOLEAN, false),
           COALESCE((metadata->>'cancelled')::BOOLEAN, false)
    INTO v_ingredient, v_qty, v_amount, v_meta, v_is_refill, v_is_adjustment, v_already
    FROM expenses
    WHERE id = p_expense_id AND address_id = p_address_id
    FOR UPDATE;

    IF v_ingredient IS NULL THEN
        RAISE EXCEPTION 'Entry % not found for address %', p_expense_id, p_address_id;
    END IF;
    IF NOT v_is_refill THEN
        RAISE EXCEPTION 'Entry % is not a restock/adjustment', p_expense_id;
    END IF;
    IF v_already THEN
        RAISE EXCEPTION 'Entry % is already cancelled', p_expense_id;
    END IF;

    -- 1. Zero-out the row in place + flag cancelled. Original numbers preserved in
    --    metadata so the card can still show the struck-through "+qty / -amount".
    UPDATE expenses SET
        amount = 0,
        metadata = v_meta
            || jsonb_build_object(
                'qty',              0,
                'cancelled',        true,
                'cancelled_at',     to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'cancelled_by',     p_staff_name,
                'cancelled_qty',    v_qty,
                'cancelled_amount', v_amount
            )
    WHERE id = p_expense_id AND address_id = p_address_id;

    -- 2. Reverse cash-out: drop the payments for this invoice.
    DELETE FROM expense_payments WHERE expense_id = p_expense_id;

    -- 3. Recompute WAC over the REMAINING real purchases (is_refill, not adjustment,
    --    amount > 0, NOT cancelled — the row above is now amount=0 so it self-excludes,
    --    but the explicit cancelled filter keeps intent clear).
    SELECT COALESCE(SUM(COALESCE((metadata->>'qty')::NUMERIC, 0)), 0),
           COALESCE(SUM(amount), 0)
    INTO v_total_qty, v_total_cost
    FROM expenses
    WHERE address_id = p_address_id AND is_refill = true
      AND metadata->>'ingredient' = v_ingredient
      AND COALESCE((metadata->>'adjustment')::BOOLEAN, false) = false
      AND COALESCE((metadata->>'cancelled')::BOOLEAN, false) = false
      AND amount > 0;

    IF v_total_qty > 0 THEN
        v_new_unit_cost := ROUND(v_total_cost / v_total_qty);
        UPDATE ingredient_costs SET unit_cost = v_new_unit_cost
        WHERE address_id = p_address_id AND ingredient = v_ingredient;
    ELSE
        v_new_unit_cost := NULL; -- no purchases left; leave unit_cost untouched
    END IF;

    RETURN jsonb_build_object(
        'success',        true,
        'ingredient',     v_ingredient,
        'cancelled_qty',  v_qty,
        'was_adjustment', v_is_adjustment,
        'new_unit_cost',  v_new_unit_cost
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_restock(UUID, UUID, TEXT) TO authenticated;

COMMIT;
