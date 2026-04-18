# Tài Liệu Hướng Dẫn Thiết Lập Tồn Kho Từ Công Thức & Tuỳ Chọn (Extras)

Tài liệu này mô tả logic tính toán giá vốn và mức tiêu hao tồn kho dựa trên công thức cơ bản và các tuỳ chọn kích cỡ của hệ thống Coffee Business.

## Cấu trúc bài toán

Khi một sản phẩm được định nghĩa qua `recipes`, nó bao gồm các thành phần cho cỡ mặc định.  
*VD: Cà phê sữa truyền thống dùng: `Ly nhỏ`, `Cà phê`, `Sữa đặc`.*

Trường hợp khách hàng gọi **Up Size** (lên Ly lớn), hệ thống sẽ cần:
- Thêm nguyên liệu bù đắp (Ví dụ: +7g Cà phê)
- Đổi vật tư vỏ ly (Ví dụ: Trừ 1 thẻ `Ly nhỏ`, cộng 1 thẻ `Ly lớn`).

Nếu hệ thống setup rời rạc hoặc bỏ qua logic bù trừ, nó sẽ luôn luôn báo hụt kho cho lượng cà phê tăng thêm này, và hụt kho tồn đối với vật tư `Ly lớn`. Ngược lại `Ly nhỏ` sẽ hiện ra là xuất dư.

## Giải pháp: Hệ số Âm (-) Cân Đối Trong `extraIngredients`

Bảng `extraIngredients` ngoài việc lưu nguyên liệu khách mua thêm, còn có thể đóng vai trò **Nghiệp vụ Chuyển Đổi** bằng hệ số âm dương.

1. **Tuỳ chọn thêm thông thường (Topping)**
   - Ví dụ: Thêm Trân châu => Set `amount: 50` (Tương đương thêm 50 gram trân châu)

2. **Tuỳ chọn nâng cấp kích cỡ (Up Size L)**
   - Khi khách chọn nâng Size L, cần **Thêm** `Ly Lớn`, nhưng phải lấy đi (thu hồi) phần `Ly Nhỏ` dư thừa do công thức gốc đã tự động cộng vào.
   - Setup `extra_ingredients`:
     - Thẻ kho `Cà Phê`: `amount: 7`  (Thêm cà phê)
     - Thẻ kho `Ly Lớn`: `amount: 1` (Sử dụng 1 Ly Lớn)
     - Thẻ kho `Ly Nhỏ`: `amount: -1` (Bù trừ âm 1 Ly Nhỏ của công thức gốc)

### Cơ chế tính toán trong `src/utils/inventory.js`
1. Thuật toán `calculateEstimatedConsumption` sẽ cộng dồn công thức món chính với hệ số nhân của các Extra khách hàng chọn (`amount * quantity`).
2. Với bài toán up-size, thành phần `Ly Nhỏ` sẽ có giá trị: `(Công thức gốc) 1 + (Bù trừ) -1 = 0`. Thuật toán có bước dọn những nguyên liệu kết quả bằng 0 để giao diện sạch sẽ.
3. Thuật toán `calculateItemCost` cũng lấy lượng bù trừ (cả âm và dương) nhân cho `ingredientCosts` (đơn giá vốn mỗi thẻ), tự động cân bằng ra **Giá vốn (COGS)** trọn vẹn của ly Size L một cách chính xác tuyệt đối.

## Cách Test Xác Nhận Logic

Thư mục Unit Test và các file minh chứng mô phỏng nằm tại: `tests/inventoryCalculation/inventory.test.js`

Để chạy mô phỏng, dùng lệnh:
```bash
npx vitest run tests/inventoryCalculation/inventory.test.js
```
