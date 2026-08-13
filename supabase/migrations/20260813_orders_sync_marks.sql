-- ==============================================================================================
-- 20260813_orders_sync_marks.sql
-- Description: watermark cho vòng poll đồng bộ đơn — trả lời "có gì đổi không" bằng 1 PK lookup.
--
-- VẤN ĐỀ. useOrdersPoll (20260813_drop_orders_realtime) mỗi nhịp tải về ĐẦU ĐƠN CỦA CẢ NGÀY
-- chỉ để so xem có gì khác. Chi phí = số nhịp × số đơn: quán càng đông thì payload càng to
-- MÀ lại càng muốn nhịp nhanh, hai thứ nhân nhau. Đo thật (gzip, 12h, 200 đơn/ngày/máy):
--   nhịp 5s → 28 MB   nhịp 2s → 69 MB   nhịp 1s → 137 MB
-- Tức là không thể mua độ trễ bằng cách hạ khoảng nhịp.
--
-- CÁCH LÀM. Một số đếm sửa đổi cho mỗi địa chỉ, do trigger trên orders nuôi. Client gửi kèm
-- số nó đang giữ; khớp thì RPC trả về đúng con số đó (~80 byte), lệch mới trả mảng đầu đơn.
-- Chi phí lúc quán vắng thành O(1) VÀ không tăng theo số đơn trong ngày ⇒ nhịp 1.5s tốn
-- ~9 MB/máy/ngày, RẺ HƠN nhịp 5s hiện tại mà nhanh hơn 3 lần.
--
-- Vì sao không quay lại Realtime: chi phí của nó tính theo SỐ KẾT NỐI ĐỒNG THỜI (trần cứng
-- ~500), tăng tuyến tính theo số máy. Watermark tính theo SỐ SỰ KIỆN THẬT và tầng chờ vẫn
-- stateless — cùng lập luận đã dùng để bỏ realtime khỏi payment, xem docs/MONETIZATION.md §7.1.
--
-- rev là số ĐỤC (opaque), KHÔNG phải số đơn: bulk_create_orders insert rồi update lại tổng
-- tiền nên một đơn có thể bump 2-3 lần. Client chỉ so bằng/khác, không bao giờ diễn giải.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

-- ── 1. Bảng watermark ────────────────────────────────────────────────────────────────────
-- ON DELETE CASCADE: xoá địa chỉ thì mốc đi theo, không để lại dòng mồ côi.
CREATE TABLE IF NOT EXISTS public.order_sync_marks (
    address_id UUID PRIMARY KEY REFERENCES public.addresses(id) ON DELETE CASCADE,
    rev        BIGINT      NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_sync_marks ENABLE ROW LEVEL SECURITY;

-- Đọc trực tiếp từ client không có đường dùng (đi qua RPC bên dưới), nhưng bật RLS mà không
-- có policy nào thì Security Advisor kêu — cấp đúng quyền đọc theo cùng luật sở hữu địa chỉ.
DROP POLICY IF EXISTS order_sync_marks_select ON public.order_sync_marks;
CREATE POLICY order_sync_marks_select ON public.order_sync_marks
    FOR SELECT TO authenticated
    USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT id FROM public.addresses WHERE manager_id = public.auth_owner_id(auth.uid())
        )
        OR address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );

-- Không có policy INSERT/UPDATE cho client: chỉ trigger (SECURITY DEFINER) được ghi.

-- ── 2. Trigger nuôi mốc ──────────────────────────────────────────────────────────────────
-- FOR EACH ROW chứ không phải statement-level: cần address_id của từng dòng. orders ghi
-- thưa (vài trăm dòng/ngày/quán) nên write amplification không đáng kể.
--
-- Có cả DELETE: đơn xoá MỀM đi bằng UPDATE nên bình thường không cần, nhưng nếu ai đó xoá
-- cứng thì mảng đầu đơn co lại mà rev đứng im ⇒ mọi máy giữ một đơn ma tới hết ca.
CREATE OR REPLACE FUNCTION public.bump_order_sync_mark()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_address_id UUID := COALESCE(NEW.address_id, OLD.address_id);
BEGIN
    IF v_address_id IS NOT NULL THEN
        INSERT INTO order_sync_marks (address_id, rev, updated_at)
        VALUES (v_address_id, 1, now())
        ON CONFLICT (address_id) DO UPDATE
            SET rev = order_sync_marks.rev + 1, updated_at = now();
    END IF;
    RETURN NULL;   -- AFTER trigger, giá trị trả về bị bỏ qua
END;
$$;

-- Hàm trigger: không ai được gọi tay, kể cả authenticated.
REVOKE EXECUTE ON FUNCTION public.bump_order_sync_mark() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bump_order_sync_mark() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bump_order_sync_mark() FROM authenticated;

DROP TRIGGER IF EXISTS trg_bump_order_sync_mark ON public.orders;
CREATE TRIGGER trg_bump_order_sync_mark
    AFTER INSERT OR UPDATE OR DELETE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION public.bump_order_sync_mark();

-- ── 3. RPC poll ──────────────────────────────────────────────────────────────────────────
-- p_rev NULL = client chưa có mốc (mới mở màn, đổi chi nhánh, sang ngày mới) → luôn trả đầu đơn.
-- Cột trả về phải KHỚP TUYỆT ĐỐI fetchTodayOrderHeads bên client — diffOrderHeads so từng cột.
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

    -- Khớp mốc ⇒ không đọc orders một dòng nào. Đây là đường chạy của gần như mọi nhịp.
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

-- ── 4. Mồi mốc cho địa chỉ đã có đơn ─────────────────────────────────────────────────────
-- Không mồi cũng chạy đúng (thiếu dòng = rev 0, client gửi NULL lần đầu nên vẫn nhận đầu đơn),
-- nhưng mồi thì nhịp đầu sau khi deploy đã có dòng để bump thay vì insert.
-- Lọc theo addresses: đơn mồ côi (địa chỉ đã xoá) sẽ làm INSERT vỡ khoá ngoại và kéo đổ
-- cả migration.
INSERT INTO public.order_sync_marks (address_id, rev)
SELECT DISTINCT o.address_id, 0
FROM public.orders o
WHERE o.address_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.addresses a WHERE a.id = o.address_id)
ON CONFLICT (address_id) DO NOTHING;

COMMIT;
