-- =============================================================
-- CHẨN ĐOÁN (3): phiếu chốt ca có rơi nhầm sang ngày VN khác với ĐƠN của nó không?
-- calculateSyncedCashFlow gom closing theo closed_at(VN) còn đơn theo created_at(VN).
-- Nếu lệch → tiền đếm bị gán sai ngày (rủi ro ở biên tuần/tháng).
-- Chạy trong Supabase SQL Editor. Chỉ ĐỌC.
-- =============================================================

-- ---- 1) Phân bố GIỜ chốt ca (VN) — chốt buổi sáng = nghi ngờ chốt cho hôm trước ----
SELECT
  extract(hour FROM (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS gio_vn,
  count(*) AS so_phieu
FROM shift_closings
GROUP BY 1
ORDER BY 1;

-- ---- 2) Mỗi phiếu chốt: ngày VN của closed_at có ĐƠN không, và đơn ngày đó kéo dài tới mấy giờ
WITH c AS (
  SELECT
    id, address_id, closed_at,
    (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS close_day_vn
  FROM shift_closings
),
o AS (
  SELECT
    address_id,
    (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS order_day_vn,
    count(*) AS n_orders,
    min(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS first_order_vn,
    max(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS last_order_vn
  FROM orders
  WHERE deleted_at IS NULL
  GROUP BY 1, 2
)
SELECT
  c.address_id,
  c.close_day_vn,
  (c.closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS closed_at_vn,
  COALESCE(o.n_orders, 0)            AS orders_same_vn_day,
  o.first_order_vn,
  o.last_order_vn
FROM c
LEFT JOIN o
  ON o.address_id = c.address_id AND o.order_day_vn = c.close_day_vn
ORDER BY c.address_id, c.close_day_vn DESC;

-- ---- 3) TÓM TẮT: số phiếu chốt rơi vào ngày VN KHÔNG có đơn nào (= gần như chắc chắn sai ngày)
WITH c AS (
  SELECT address_id, (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS close_day_vn
  FROM shift_closings
),
o AS (
  SELECT DISTINCT address_id, (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS order_day_vn
  FROM orders WHERE deleted_at IS NULL
)
SELECT
  count(*) FILTER (WHERE o.order_day_vn IS NULL) AS phieu_ngay_khong_co_don,
  count(*)                                       AS tong_phieu
FROM c
LEFT JOIN o ON o.address_id = c.address_id AND o.order_day_vn = c.close_day_vn;
