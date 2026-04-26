# Smart POS — Project Vision & Development Tracker

## Niche mục tiêu
Xe cà phê mang đi quy mô nhỏ (1–3 nhân viên), bán buổi sáng, vận hành theo ca.

## Vấn đề cốt lõi cần giải quyết
1. Nhân viên không ghi kịp số ly khi đông khách → mất dấu đơn
2. Không đếm chính xác số ly → không tính được P&L thực
3. Không quản lý thất thoát nguyên liệu → không ước lượng được mua hàng
4. Chủ không biết tiền trong két có khớp với doanh thu app hay không
5. Không biết nên mua bao nhiêu nguyên liệu cho ngày mai / tuần

---

## Trạng thái tính năng hiện tại

### Bán hàng
- [x] Bấm đơn nhanh, hỗ trợ Extra options
- [x] Offline-first — đồng bộ tự động khi có mạng
- [x] Realtime sync giữa các thiết bị

### Kiểm soát tài chính (2 lớp độc lập)
- [x] **Lớp 1 — Đối soát tiền mặt**: Cuối ca nhập tiền mặt + chuyển khoản thực nhận. Hệ thống so sánh với doanh thu app và hiển thị chênh lệch (Khớp / Thiếu / Dư) trên báo cáo ngày.
- [x] **Lớp 2 — Đối soát nguyên liệu**: Cuối ca kiểm kê tồn kho thực tế. Hệ thống tính tồn kho lý thuyết (đầu kỳ + nhập − tiêu CT) và hiển thị lệch theo từng nguyên liệu, breakdown theo sản phẩm.

### Báo cáo ngày
- [x] P&L tự động: Doanh thu / Giá vốn / Chi phí phát sinh / Chi phí cố định / Lợi nhuận ròng
- [x] So sánh lợi nhuận hôm nay vs hôm qua
- [x] Biểu đồ doanh thu tích lũy theo giờ
- [ ] Nút chia sẻ báo cáo nhanh (screenshot → Zalo)

### Báo cáo tuần / tháng
- [x] Tổng hợp doanh thu, giá vốn, chi phí, lợi nhuận theo kỳ
- [x] Biểu đồ hiệu suất từng ngày trong kỳ (DayPerformanceChart)
- [x] Phân tích menu: Star / Plow / Puzzle / Dog (Menu Engineering)

### Gợi ý đi chợ
- [x] Tính lượng mua dựa trên tiêu hao trung bình 7 ngày thực tế
- [x] Điều chỉnh hệ số hao hụt (0–30%)

### Quản lý địa điểm
- [x] Multi-address: menu, giá, nhân viên, báo cáo riêng từng xe
- [x] Backup & restore dữ liệu
- [ ] Màn hình /address cải thiện: hiển thị KPI nhanh hơn, trực quan hơn

### Infrastructure
- [x] DB indexes cho orders, order_items, shift_closings, expenses
- [x] RPC aggregate thay thế 2 query riêng (revenue + cups)
- [x] Không còn select('*') — tất cả query dùng column list cụ thể
- [x] Fetch cache trong RangeReportPage (navigation lần 2 instant)
- [x] useMemo / O(1) Map lookup — không re-render thừa

---

## Roadmap ưu tiên

### Ngắn hạn
- [ ] **Cải thiện /address**: KPI realtime (doanh thu hôm nay, số ly) hiển thị trực tiếp trên card địa điểm
- [ ] **Share báo cáo**: Nút share trên /daily-report → screenshot đẹp gửi Zalo

### Trung hạn
- [ ] **Daily target + KPI**: Chủ đặt mục tiêu ly / doanh thu ngày. Hiển thị tiến độ trên POS. Đồng bộ với 2 lớp kiểm soát (tiền khớp + nguyên liệu khớp) để tính KPI ca thực tế.
- [ ] **Push notification**: Cảnh báo tồn kho thấp, doanh thu đạt mục tiêu

### Dài hạn (khi có traction)
- [ ] Cổng thanh toán (thu 17k/ngày/xe)
- [ ] Admin dashboard tổng hợp toàn bộ địa điểm
- [ ] Onboarding tự động

---

## Monetization
- **Free**: Tạo đơn, menu, nguyên liệu — không giới hạn
- **Trả phí**: 17.000đ/ngày/xe — mở khoá báo cáo ngày hôm đó

---

*Cập nhật lần cuối: 2026-04-26*
