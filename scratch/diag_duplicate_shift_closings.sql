-- =============================================================
-- CHẨN ĐOÁN: ngày có >1 phiếu chốt ca (gây double-count ở báo cáo Tuần/Tháng)
-- Chạy trong Supabase SQL Editor. Chỉ ĐỌC, không sửa dữ liệu.
--
-- Bối cảnh: report Tuần/Tháng (calculateSyncedCashFlow nhánh range) cộng dồn
-- actual_cash/actual_transfer của MỌI phiếu trong kỳ, trong khi report Ngày chỉ
-- lấy phiếu mới nhất/ngày (RPC ... ORDER BY closed_at DESC LIMIT 1). Nếu 1 ngày
-- có nhiều phiếu → Tuần/Tháng bị cộng dư so với tổng các ngày.
-- =============================================================

-- ---- 1) Tổng quan: bao nhiêu (address, ngày VN) đang có >1 phiếu ----
WITH per_day AS (
  SELECT
    address_id,
    (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS biz_date,
    count(*)                                           AS n_closings,
    sum(actual_cash)                                   AS sum_cash,
    sum(actual_transfer)                               AS sum_transfer,
    -- giá trị mà report NGÀY dùng (phiếu mới nhất)
    (array_agg(actual_cash      ORDER BY closed_at DESC))[1] AS latest_cash,
    (array_agg(actual_transfer  ORDER BY closed_at DESC))[1] AS latest_transfer
  FROM shift_closings
  GROUP BY address_id, (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
)
SELECT
  count(*) FILTER (WHERE n_closings > 1)                          AS days_with_duplicates,
  count(*)                                                        AS total_days,
  COALESCE(sum((sum_cash - latest_cash))     FILTER (WHERE n_closings > 1), 0) AS cash_overcounted,
  COALESCE(sum((sum_transfer - latest_transfer)) FILTER (WHERE n_closings > 1), 0) AS transfer_overcounted
FROM per_day;

-- ---- 2) Chi tiết từng ngày bị trùng (để soi & dọn) ----
WITH per_day AS (
  SELECT
    address_id,
    (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS biz_date,
    count(*)                                           AS n_closings,
    sum(actual_cash)                                   AS sum_cash,
    sum(actual_transfer)                               AS sum_transfer,
    (array_agg(actual_cash     ORDER BY closed_at DESC))[1] AS latest_cash,
    (array_agg(actual_transfer ORDER BY closed_at DESC))[1] AS latest_transfer,
    array_agg(id::text          ORDER BY closed_at DESC)     AS closing_ids,
    array_agg(closed_at         ORDER BY closed_at DESC)     AS closed_ats
  FROM shift_closings
  GROUP BY address_id, (closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
)
SELECT
  address_id,
  biz_date,
  n_closings,
  sum_cash,      latest_cash,      (sum_cash - latest_cash)         AS cash_diff,
  sum_transfer,  latest_transfer,  (sum_transfer - latest_transfer) AS transfer_diff,
  closing_ids,
  closed_ats
FROM per_day
WHERE n_closings > 1
ORDER BY address_id, biz_date DESC;
