-- ==============================================================================================
-- 20260919_order_paid_at.sql
-- Description: tách "đã thu tiền" khỏi "đóng bàn".
--
-- Trước đây Tính tiền = table_closed_at = bàn biến khỏi lưới. Nhưng quán có khách trả tiền
-- xong vẫn NGỒI TIẾP — bàn biến mất trong khi còn người, gọi thêm thì mở ra bàn mới trùng
-- tên. Giờ:
--   orders.paid_at         — NULL = đợt này chưa thu. Pill Tính tiền từng đợt, bật/tắt như Ra món.
--   orders.table_closed_at — "Dọn bàn", khách đã về, bàn rời lưới (còn đợt chưa thu thì hỏi lại).
-- Mức ĐỢT (như served_at): khách đã thu gọi thêm thì đợt mới tự thành "chưa thu".
-- Không backfill: bàn đang mở lúc chạy migration là bàn chưa tính tiền (luật cũ).
--
-- orders_sync trả thêm paid_at + print_count để máy khác thấy nhãn "Đã thu" / "Đã in bill"
-- trên thẻ bàn trong một nhịp poll (diffOrderHeads ở useOrdersPoll.js so cả hai cột).
-- Cùng signature → grant cũ giữ nguyên; vẫn khai lại search_path + guard (xem CLAUDE.md).
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.orders_sync(p_address_id UUID, p_rev BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rev   BIGINT;
    v_since TIMESTAMPTZ;
    v_heads JSONB;
BEGIN
    -- Ownership guard. Allows admin / direct manager / co-manager via user_address_access.
    -- Skip when auth.uid() IS NULL (service_role / migrations bypass, mirroring RLS).
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

    SELECT rev INTO v_rev FROM order_sync_marks WHERE address_id = p_address_id;
    v_rev := COALESCE(v_rev, 0);

    IF p_rev IS NOT NULL AND p_rev = v_rev THEN
        RETURN jsonb_build_object('rev', v_rev);
    END IF;

    v_since := date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',              o.id,
        'total',           o.total,
        'discount_amount', o.discount_amount,
        'deleted_at',      o.deleted_at,
        'deleted_by',      o.deleted_by,
        'served_at',       o.served_at,
        'paid_at',         o.paid_at,
        'print_count',     o.print_count,
        'table_closed_at', o.table_closed_at,
        'table_name',      o.table_name
    )), '[]'::jsonb)
    INTO v_heads
    FROM orders o
    WHERE o.address_id = p_address_id
      AND o.created_at >= v_since;

    RETURN jsonb_build_object('rev', v_rev, 'heads', v_heads);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.orders_sync(UUID, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orders_sync(UUID, BIGINT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.orders_sync(UUID, BIGINT) TO authenticated;

COMMIT;
