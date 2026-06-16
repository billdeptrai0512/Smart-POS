-- =============================================================
-- Chặn GỐC trùng phiếu chốt ca (mỗi address tối đa 1 phiếu / ngày VN).
--
-- Bối cảnh: report Tuần/Tháng cộng dồn MỌI phiếu trong kỳ, trong khi report Ngày chỉ
-- lấy phiếu mới nhất/ngày (RPC ... ORDER BY closed_at DESC LIMIT 1). Hai đường lưu
-- (tồn-kho / thực-thu) lệch id + replication lag đã tạo ra nhiều phiếu cùng ngày
-- (dữ liệu thật: có ngày tới 4 phiếu) → Thực thu/hao hụt Tuần/Tháng bị double-count,
-- không khớp tổng các Ngày. UI đã dedup phía hiển thị; migration này chặn ở DB để
-- không sinh thêm + dọn phiếu trùng cũ.
-- =============================================================

-- 1) Helper IMMUTABLE: ngày KINH DOANH (VN, UTC+7 cố định, không DST) của 1 timestamptz.
--    `AT TIME ZONE 'UTC'` cho timestamp-không-tz theo wall-clock UTC (deterministic),
--    +7h rồi ::date (không phụ thuộc session TimeZone) → an toàn để dùng trong index.
CREATE OR REPLACE FUNCTION vn_business_date(ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ((ts AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date
$$;

-- Hàm helper thuần (không đọc bảng) → không cần ownership guard. Theo CLAUDE.md:
-- signature mới ⇒ siết quyền, chỉ authenticated được EXECUTE (insert phiếu là manager).
REVOKE ALL ON FUNCTION vn_business_date(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vn_business_date(TIMESTAMPTZ) TO authenticated;

-- 2) Dọn phiếu trùng cũ: giữ phiếu MỚI NHẤT mỗi (address_id, ngày VN) — đúng phiếu mà
--    report Ngày đang hiển thị (closed_at DESC). Tiebreak created_at, id cho ổn định.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY address_id, vn_business_date(closed_at)
           ORDER BY closed_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM shift_closings
)
DELETE FROM shift_closings s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

-- 3) Khoá cứng: mỗi address tối đa 1 phiếu / ngày VN. Insert trùng → 23505, app tự
--    lành bằng cách UPDATE phiếu cùng ngày (xem insertShiftClosing).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shift_closings_address_vn_day
  ON shift_closings (address_id, vn_business_date(closed_at));
