# TASK — việc làm sau

## Range scope (tuần/tháng): phân loại chi tiền mặt theo từng ngày
**Bối cảnh:** Báo cáo dòng tiền phân loại chi tiền mặt "trước/sau chốt ca tiền" bằng mốc
`shift_closings.cash_closed_at` (xem [[project-cash-close-phase]] / `computeCashFlowTotals`).
Logic này đúng cho **daily** scope. Ở **range** (week/month/custom) hiện chỉ có 1 mốc chốt
(closing cuối khoảng) đem so với payments của **nhiều ngày** → phân loại không chính xác.
Range RPC (`get_report_by_range`) cũng chưa trả `cash_closed_at` trong `target_shift_closings`.

**Cần làm:**
- `get_report_by_range`: thêm `cash_closed_at` vào `target_shift_closings` (và prev nếu cần).
- Phân loại **từng** payment/expense theo `cash_closed_at` của **đúng ngày** của nó (map dayStr → cash_closed_at), không dùng 1 mốc chung.
- Cập nhật `CashFlowCard` / `computeCashFlowTotals` để nhận map theo ngày khi ở range scope.
- Verify: tổng range = Σ daily (cộng từng ngày khớp với báo cáo ngày).

**Hiện trạng tạm chấp nhận:** range coi như xấp xỉ (đúng cho ca phổ biến mua hàng trong ca),
không tệ hơn bản trước khi có feature.
