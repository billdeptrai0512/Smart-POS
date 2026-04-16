# ☕ Coffee Cart Optimizer (Máy phát hiện thất thoát & Tối ưu lợi nhuận)

Một hệ thống quản lý bán hàng (POS) thiết kế chuyên biệt cho mô hình xe cà phê mang đi (bán chân chống, bán buổi sáng). Hệ thống giải quyết trực tiếp các bài toán mấu chốt: chống thất thoát nguyên liệu và tối ưu tỷ suất lợi nhuận trên mỗi điểm bán.

## 🌟 Tầm nhìn dự án (Project Vision)

Được định hướng là một cỗ máy tự động nhận diện lỗ hổng tài chính và dẫn dắt quyết định kinh doanh, hệ thống tập trung vào 5 trụ cột (Key Features):

1. **🚨 Detect thất thoát (Must-have)**
   - Cảnh báo tồn kho theo thời gian thực (Low stock & Out of stock).
   - Quản lý định lượng cốt lõi và Extra options chi tiết cho từng loại nước uống, đối chiếu chính xác giữa doanh số bán ra và nguyên liệu tiêu hao.
2. **💰 P&L theo từng xe (Must-have)**
   - Báo cáo tài chính thu nhỏ (`FinanceCards`) và trực quan (Gross/Net Profit).
   - Phân tích chi tiết Doanh thu, Cost of Goods Sold (Giá vốn) và Chi phí phát sinh riêng lẻ cho từng điểm bán (xe) theo phiên làm việc.
3. **⚠️ So sánh hiệu suất (Xe & Nhân viên)**
   - Dashboard tổng quan cho phép giám sát ngay lập tức số lượng ly bán ra của từng điểm.
   - Kiểm soát quyền truy cập và định danh rõ ràng nhân viên (staff) nào đang đảm nhận ca trực tại xe nào.
4. **⏱️ Time Optimization (Tối ưu thời gian)**
   - Phân tích lưu lượng khách hàng qua **Heatmap / Biểu đồ theo giờ**. 
   - Hỗ trợ ra quyết định phân bổ nhân lực và dự phòng nguyên liệu chính xác vào các "khung giờ vàng" buổi sáng.
5. **🤖 Gợi ý hành động thông minh**
   - Phân loại menu tự động bằng ma trận **Menu Engineering** (Star 🌟, Plow 🐴, Puzzle 🧩, Dog 🐶).
   - Hỗ trợ ra phán đoán chiến lược: Món nào nên giữ, món nào cần loại bỏ, và món nào nên đẩy mạnh up-sell.

---

## 📊 Đánh giá độ hoàn thiện (Current Evaluation: 9/10)

Dựa trên bộ khung Vision đã đề ra, dự án hiện tại đáp ứng gần như hoàn hảo các mục tiêu cốt lõi:

- **[ 10/10 ] 🚨 Detect thất thoát**: Hoạt động mượt mà với tính năng `StockWarnings` tự động tổng hợp nguyên liệu cạn kiệt và cảnh báo đến người vận hành.
- **[ 10/10 ] 💰 P&L per xe**: Tích hợp thẻ tài chính chuyên sâu tính toán Real-time giá vốn và biên lợi nhuận ròng dựa trên công thức cấu thành mảng Menu.
- **[ 9/10 ] ⚠️ So sánh xe + nhân viên**: Màn hình `Address Select` đã show đầy đủ các chỉ số của từng chi nhánh/xe (số tách bán ra, nhân viên đang hoạt động). *Đang ở mức overview tốt nhưng có thể biểu đồ hóa sự so sánh này trong tương lai.*
- **[ 10/10 ] ⏱️ Time optimization**: Biểu đồ hình nến/nhiệt thể hiện chi tiết mật độ đơn hàng tới từng ngóc ngách thời gian thực.
- **[ 8/10 ] 🤖 Gợi ý hành động**: Logic phân loại chuẩn xác theo `MenuEngineering`. *(Dự định cải thiện thành một agent AI hoặc prompt popup đưa ra thông báo dạng text mang tính điều hướng mạnh hơn).*

**Tổng kết:** Nền tảng hiển thị mức độ trưởng thành rất tốt, logic lõi đã được áp dụng triệt để ở tầng UI/Components.

---

## 🚀 Công nghệ sử dụng
- **React + Vite**: Tốc độ phản hồi cực nhanh, thiết kế Component-based linh hoạt.
- **TailwindCSS**: Chuẩn hóa giao diện hướng Mobile-first/PWA (Tối ưu hiển thị cho thiết bị cầm tay của nhân viên).
- **PWA (Progressive Web App)**: Cho phép cài đặt ứng dụng độc lập trên OS mà không cần đưa lên App Store/Google Play.
