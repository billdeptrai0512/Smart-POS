# Smart POS — Máy tính tiền cho xe cà phê mang đi

## Câu chuyện bắt đầu

Buổi sáng mình mở một xe cà phê bán mang đi trước nhà. Trộm vía được khách ủng hộ nhiều, mình quyết định thuê thêm 2 bạn nhân viên phụ bán.

Tụi mình đánh dấu số ly bán trong ngày, kiểm kê hàng tồn kho vào cuối ngày bằng **bút và giấy**.

---

## 5 vấn đề phát sinh

**1. Nhân viên không đánh dấu kịp số ly đã bán khi khách đông.**

**2. Nhân viên không nhớ mình đã đánh dấu tới ly nào của khách sau đó để tiếp tục.**

**3. Không đếm được chính xác số ly → Không thể tính chính xác giá vốn, chi phí trong ngày, chi phí cố định để xác định lợi nhuận ròng của điểm bán.**

**4. Không đếm được chính xác số ly → Không thể quản lý thất thoát nguyên vật liệu sử dụng trong ngày.**

**5. Không quản lý được thất thoát nguyên vật liệu trong ngày → Không thể ước lượng tiêu hao trung bình mỗi ngày để gợi ý nên bổ sung nguyên vật liệu đủ cho ngày mai / tuần.**

---

## Smart POS giải quyết từng vấn đề như thế nào

| Vấn đề | Giải pháp |
|--------|-----------|
| Không ghi kịp số ly | Nhân viên bấm đơn trực tiếp trên điện thoại, đơn ghi lại tức thì — không cần nhớ, không cần đánh dấu lại. |
| Mất dấu đơn đang xử lý | Đơn hiện trên màn hình cho đến khi xác nhận xong. Hỗ trợ offline — mất mạng vẫn bán được, tự đồng bộ khi có lại kết nối. |
| Không tính được P&L | Báo cáo ngày tự động tính: Doanh thu − Giá vốn − Chi phí phát sinh − Chi phí cố định = **Lợi nhuận ròng**. |
| Không phát hiện thất thoát nguyên liệu | Cuối ca: hệ thống so sánh tồn kho *lý thuyết* (tính từ số ly đã bán × định lượng) với tồn kho *thực tế* (nhân viên kiểm kê). Lệch bao nhiêu hiển thị ngay. |
| Không biết nên mua bao nhiêu nguyên liệu | Tab **Đi chợ** tính mức tiêu hao trung bình 7 ngày gần nhất và gợi ý số lượng cần mua thêm cho ngày mai, có tùy chỉnh hệ số hao hụt. |

---

## Tính năng

### Bán hàng
- Bấm đơn nhanh, hỗ trợ Extra options (size, topping, đường, đá…)
- Hoạt động offline — đồng bộ tự động khi có mạng trở lại
- Realtime: mọi đơn mới hiển thị ngay trên màn hình quản lý

### Báo cáo ngày
- P&L tự động: Doanh thu / Giá vốn / Chi phí phát sinh / Chi phí cố định / Lợi nhuận ròng
- Biểu đồ doanh thu theo giờ — xác định khung giờ vàng
- So sánh lợi nhuận hôm nay vs hôm qua

### Kiểm kê & phát hiện thất thoát
- Đối chiếu tồn kho lý thuyết vs thực tế theo từng nguyên liệu
- Hiển thị chi tiết: nguyên liệu nào bị hụt bao nhiêu, do sản phẩm nào tiêu hao
- Cảnh báo tồn kho thấp trong quá trình bán

### Gợi ý đi chợ
- Tính lượng mua dựa trên trung bình tiêu hao 7 ngày thực tế
- Điều chỉnh hệ số hao hụt (0–30%)

### Báo cáo tuần / tháng
- Doanh thu, giá vốn, chi phí, lợi nhuận theo kỳ
- Biểu đồ hiệu suất từng ngày trong kỳ
- Phân tích menu: sản phẩm nào bán chạy, sản phẩm nào cần xem lại (Menu Engineering)

### Quản lý đa điểm
- Mỗi địa điểm (xe) có menu, giá, nhân viên và báo cáo riêng biệt
- Backup & restore dữ liệu theo từng điểm

---

## Công nghệ

- **React + Vite** — tốc độ phản hồi nhanh, component-based
- **Supabase** — realtime database, auth, RPC aggregation
- **TailwindCSS** — mobile-first, tối ưu cho điện thoại nhân viên
- **PWA** — cài như app native, không cần App Store / Google Play

---

## Mô hình kinh doanh

- **Free**: Tạo đơn, tạo menu, thêm nguyên liệu — không giới hạn.
- **Trả phí**: 17.000 đ/ngày/xe — thanh toán cuối ngày để mở khoá báo cáo ngày hôm đó.

---

*Developed by [billdeptrai0512](https://github.com/billdeptrai0512)*
