-- ==============================================================================================
-- set_inventory_confirm: chỉ đóng dấu entry CHƯA có confirmed_at (mới đếm / vừa sửa số sau lần xác nhận trước).
-- Trước đây bấm lại khi chưa sửa gì vẫn dời counted_at của mọi entry về bây giờ trong khi `remaining` còn là số đếm cũ
-- → đơn bán từ lần xác nhận trước tới giờ bị coi như đã nằm trong số đếm, tồn quầy nhảy ngược lên.
-- Phần còn lại giữ nguyên 100% so với 20261041_inventory_audit_confirm.sql.
-- ==============================================================================================

CREATE OR REPLACE FUNCTION public.set_inventory_confirm(p_address_id uuid)
RETURNS shift_closings
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_row shift_closings;
BEGIN
    SELECT * INTO v_row
      FROM shift_closings
     WHERE address_id IS NOT DISTINCT FROM p_address_id
       AND vn_business_date(closed_at) = vn_business_date(now())
     ORDER BY closed_at DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Chưa có phiếu kiểm kê hôm nay';
    END IF;

    UPDATE shift_closings
       SET inventory_report = (
            SELECT COALESCE(jsonb_agg(
                CASE WHEN e->>'remaining' IS NOT NULL AND e->>'confirmed_at' IS NULL
                     THEN e || jsonb_build_object('confirmed_at', now(), 'counted_at', now())
                     ELSE e END), '[]'::jsonb)
              FROM jsonb_array_elements(COALESCE(v_row.inventory_report, '[]'::jsonb)) e)
     WHERE id = v_row.id
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_inventory_confirm(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_inventory_confirm(uuid) TO authenticated;
