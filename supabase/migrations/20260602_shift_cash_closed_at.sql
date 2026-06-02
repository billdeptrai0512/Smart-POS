-- Tách "chốt ca tiền thực thu" khỏi "chốt ca tồn kho".
--
-- cash_closed_at = thời điểm bấm "Lưu thực thu" (chốt tiền). Dùng để phân loại mỗi
-- khoản chi TIỀN MẶT của ngày:
--   • paid_at/created_at < cash_closed_at  → "trước chốt": tiền rút từ két trong ca,
--     đã làm hụt actual_cash → CỘNG vào Thực thu (dựng lại doanh thu tiền mặt).
--   • >= cash_closed_at                    → "sau chốt": lấy tiền đã đếm ra tiêu →
--     TRỪ vào Thực nhận (tiền mang về).
--   • cash_closed_at IS NULL               → chưa chốt → mọi khoản coi như trước chốt.
--
-- Chuyển khoản không bị ảnh hưởng (không động đến két).
--
-- Lưu ý: các RPC get_daily_report_context / get_report_by_date liệt kê cột shift_closing
-- tường minh nên KHÔNG tự trả cột này; client (reportService.attachCashClosedAt) đọc bổ
-- sung bằng 1 PK lookup. Không cần sửa RPC.

ALTER TABLE shift_closings
    ADD COLUMN IF NOT EXISTS cash_closed_at timestamptz;

COMMENT ON COLUMN shift_closings.cash_closed_at IS
    'Mốc chốt ca tiền thực thu (bấm "Lưu thực thu"). Phân loại chi tiền mặt trước/sau chốt cho báo cáo dòng tiền. NULL = chưa chốt.';
