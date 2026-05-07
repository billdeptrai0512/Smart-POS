# Inventory & COGS Architecture

## Hai dòng chảy tách biệt

### 1. Đi chợ (Mua hàng → Kho tổng)
- **Nơi thực hiện**: `/ingredients` → nút **+ Nhập kho** trên từng card → RestockModal.
- **Tác dụng**:
  - Tạo `expenses` với `is_refill=true` (`metadata.ingredient`, `metadata.qty`, `metadata.price`).
  - Cập nhật `ingredient_costs.unit_cost` bằng Weighted Average.
  - **Tăng kho tổng** (xem mục "Nguồn dữ liệu" bên dưới).
- **Không** đi qua `/shift-closing`. Đây là dòng tăng kho tổng duy nhất.

### 2. Chốt ca (Kiểm kê thực tế tại quầy)
- **Nơi thực hiện**: `/shift-closing` — màn hình chốt ca tại quầy bán.
- **3 trường / nguyên liệu** (lưu trong `shift_closings.inventory_report[]`):
  - `opening` — Tồn đầu ca tại quầy (kế thừa từ `remaining` ca trước).
  - `restock` — **Nhập thêm**: lượng rút từ kho tổng → quầy trong ca này. Đây là dòng **giảm** kho tổng.
  - `remaining` — Tồn cuối thực đếm tại quầy. Là **ground truth** của kho quầy.

## Công thức tồn kho hiển thị trên `/ingredients`

```
current_stock = warehouse_stock + counter_stock
```

Trong đó:
- `warehouse_stock = max(0, Σ refill_qty − Σ restock_post_first_refill)`
  - `Σ refill_qty` — tổng `metadata.qty` của tất cả expenses `is_refill=true` (tính theo từng nguyên liệu, theo `address_id`).
  - `Σ restock_post_first_refill` — tổng `restock` từ tất cả `shift_closings.inventory_report[]`, **chỉ tính các shift xảy ra sau lần refill đầu tiên** của nguyên liệu đó. Restock trước thời điểm refill đầu được coi là tiêu thụ tồn pre-system → bỏ qua.
  - Clamp `≥ 0` để tránh số âm khi dữ liệu lịch sử thiếu refill.
- `counter_stock = remaining` của shift_closing **gần nhất** (theo `created_at` desc).

### Ví dụ (cà phê)
- Ngày T-1: nhập kho qua `/ingredients` 10 000 g → expense refill, qty = 10 000.
- Ca T: `opening = 610`, `restock = 1 000` (rút từ kho tổng), `remaining = 318`.
- Hiển thị `/ingredients`: `(10 000 − 1 000) + 318 = 9 318 g`.

### Edge cases
- **Chưa có shift_closing nào** → `counter_stock = 0` → display = `warehouse_stock` (kho tổng thuần).
- **Chưa có refill nào** → `warehouse_stock = 0` → display = `counter_stock` (chỉ tồn quầy ca gần nhất).
- **Shift đang mở (chưa chốt)** → `counter_stock` cố định ở giá trị shift đã chốt gần nhất; chỉ thay đổi khi ca mới được chốt. Refill mới (đi chợ) trong khoảng đó vẫn cộng ngay vào `warehouse_stock`.

## Implementation
- **JS**: [`fetchIngredientStocks`](../src/services/orderService.js) — đọc `shift_closings`, `expenses(is_refill=true)`, tính theo công thức trên. **Không** đọc `inventory.stock` hay `ingredients.stock` (cả hai đều không được duy trì).
- **RPC** `process_ingredient_restock` — chỉ tạo expense + cập nhật `ingredient_costs.unit_cost`. Không update `inventory.stock`.
- **Trigger** `subtract_stock_from_restock` (trên `shift_closings`) — đang trỏ sai bảng (`inventory` thay vì storage thực) và sai công thức. **Đang vô dụng** với logic hiện tại; có thể xóa khi tiện.

## Database Tables liên quan
- `shift_closings` — `inventory_report` JSONB: `[{ingredient, opening, restock, remaining}]`, `created_at`, `address_id`.
- `expenses` — `is_refill=true`, `metadata` JSONB: `{ingredient, qty, price, ...}`, `created_at`, `address_id`.
- `ingredient_costs` — `ingredient`, `unit_cost`, `unit`, `address_id` (giá vốn theo Weighted Average).
- `recipes` — `product_id`, `ingredient`, `amount` (định mức/ly).

## Lưu ý vận hành
- Để kho tổng hiển thị đúng, **mọi lần mua nguyên liệu phải nhập qua `/ingredients` → + Nhập kho**. Không có nguồn dữ liệu thay thế.
- Khi xảy ra mismatch, manager kiểm tra: refill đã đầy đủ chưa, restock có nhập đúng không, `unit_cost` có cần điều chỉnh không.
