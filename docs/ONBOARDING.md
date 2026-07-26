# Onboarding Guide ("Bắt đầu bán hàng")

Tài liệu này mô tả widget hướng dẫn 5 bước hiện ở góc trái màn hình cho user mới (guest
mode). Đọc xong bạn sẽ trả lời được: *"Guide đang tính bước nào là bước hiện tại, và muốn
sửa/thêm 1 bước thì sửa ở đâu?"*

---

## 1. Chỉ hiện với guest mode

```js
if (!isGuest || !addressId || !loaded) return null
```

[OnboardingGuide.jsx](../src/components/common/onboarding/OnboardingGuide.jsx) chỉ render khi
`isGuest === true` (xem [AuthContext](../src/contexts/AuthContext.jsx)). User đã đăng nhập thật
không bao giờ thấy widget này — đây là quyết định có chủ đích (commit `4cd8cd1`), không phải bug.

Widget được mount **một lần duy nhất** ở layout level (`OnboardingLayout` trong
[App.jsx](../src/App.jsx)), không phải mỗi trang tự gắn. Trang nào có UI đáy màn hình riêng
(FAB, thanh Hủy/Lưu của sort-mode...) tự che/dịch guide qua
[`useOnboardingVisibility()`](../src/contexts/OnboardingVisibilityContext.jsx) (`setHidden`,
`setBottomOffset`) thay vì unmount guide.

---

## 2. Cấu trúc file — mỗi bước 1 file

```
src/components/common/onboarding/
├── OnboardingGuide.jsx     ← shell: fetch data dùng chung, chọn bước active, render khung/pill
├── ChecklistRow.jsx        ← 1 dòng checklist dùng chung (label + tick)
└── steps/
    ├── menuStep.jsx             (1) Menu
    ├── mainStockStep.jsx        (2) Tồn kho nguyên liệu chính
    ├── packagingStockStep.jsx   (3) Tồn kho bao bì
    ├── cashReportStep.jsx       (4) Báo cáo thực thu
    └── inventoryStep.jsx        (5) Kiểm kê tồn cuối ca
```

Mỗi file trong `steps/` export **default 1 object**:

```js
export default {
    to: '/route',           // navigate() tới đâu khi bấm nút
    state: {...},           // (optional) state kèm theo navigate
    navLabel: 'Đi tới ...',
    done: (ctx) => boolean, // logic: bước này xong chưa?
    Body: ({ ctx }) => JSX, // UI: render checklist con của riêng bước này
}
```

`ctx` là 1 object dữ liệu dùng chung do `OnboardingGuide` build 1 lần mỗi render (xem §4), truyền
xuống cho `done()` và `<Body>` của **mọi** bước — không phải mỗi bước tự fetch riêng.

Muốn sửa nội dung/điều kiện của 1 bước → chỉ sửa đúng 1 file trong `steps/`, không đụng shell.
Muốn thêm bước 6 → thêm file mới theo khuôn trên rồi chèn vào mảng `STEPS` trong
`OnboardingGuide.jsx`.

---

## 3. Cách chọn bước hiện tại

```js
const STEPS = [menuStep, mainStockStep, packagingStockStep, cashReportStep, inventoryStep]
const idx = STEPS.findIndex(s => !s.done(ctx))
if (idx === -1) return null   // xong cả 5 bước → widget biến mất hẳn
```

Bước hiện tại = bước **chưa done đầu tiên**, theo đúng thứ tự khai báo. Không có khái niệm "bỏ
qua 1 bước" — nếu bước 2 chưa xong, dù bước 3-5 đã xong, widget vẫn đứng ở bước 2.

---

## 4. 5 bước và điều kiện "done"

| # | Bước | File | Điều kiện done | Nguồn dữ liệu |
|---|---|---|---|---|
| 1 | Menu | `menuStep.jsx` | Tick tay đủ 4/4 việc (Tạo món, Cài định lượng, Tạo mục, Sắp xếp menu) | `localStorage` (`onboarding_v3_<addressId>`), **không tự detect** — chỉ user biết menu đã "đúng thực tế" chưa |
| 2 | Tồn kho nguyên liệu chính | `mainStockStep.jsx` | 100% nguyên liệu non-packaging có `warehouse_stock_set` **và** `counter_stock_set` | `fetchIngredientStocks()` → RPC `get_ingredient_stocks_v2` |
| 3 | Tồn kho bao bì | `packagingStockStep.jsx` | Như trên, lọc `normalizeIngredientCategory() === 'packaging'` | như trên |
| 4 | Báo cáo thực thu | `cashReportStep.jsx` | `actual_cash` **và** `actual_transfer` đã từng nhập (bất kỳ lần chốt ca nào trong 30 lần gần nhất, không cần cùng 1 lần) | `hasCompletedCashReport()` → bảng `shift_closings` |
| 5 | Kiểm kê tồn cuối ca | `inventoryStep.jsx` | Từng có **1 lần chốt ca** mà `remaining` đủ 100% nguyên liệu (kể cả bao bì) trong cùng 1 báo cáo | `hasCompletedShiftClosing()` → bảng `shift_closings`, quét 30 lần gần nhất |

> [!IMPORTANT]
> Bước 2/3 dùng cờ `warehouse_stock_set` / `counter_stock_set` (không phải `> 0`) để phân biệt
> "chưa từng nhập" với "nhập bằng 0". Cờ này chỉ có từ migration
> `20260720_ingredient_stocks_set_flags.sql` — trước đó cả 2 case đều collapse về `0` qua
> `COALESCE`, khiến checklist không bao giờ báo done nếu tồn thực = 0. Xem
> [INVENTORY_LOGIC.md](INVENTORY_LOGIC.md) để hiểu sâu hơn cách 2 kho được suy ra.

Bước 4-5 tick "lỏng" — chỉ cần **đã từng làm** (quét lịch sử), không phải "đã làm hôm nay". Làm
vậy để guide không tái xuất hiện mỗi sáng khi dữ liệu ngày mới reset (checklist con của 2 bước
này — số đếm hôm nay — chỉ để hiện tiến độ, không phải điều kiện qua bước).

---

## 5. `ctx` — dữ liệu shell truyền xuống từng bước

Build trong `OnboardingGuide.jsx` mỗi lần render (sau khi `reload()` fetch xong):

```js
const ctx = {
    local, toggleChecklistItem,                          // bước 1 (state cục bộ)
    stockProgress, totalMain, totalPackaging, totalStock, // bước 2-3, 5
    todayClosing, countedToday,                           // bước 4-5
    cashReportDone, closingDone,                          // bước 4-5 (điều kiện done)
}
```

`reload()` gọi song song 4 API 1 lần duy nhất (`Promise.all`), chạy lại khi: đổi `addressId`,
đổi `ingredientConfigs`, tab quay lại foreground (`visibilitychange`), hoặc trang khác gọi
`requestRefresh()` từ `useOnboardingVisibility()` sau khi vừa lưu dữ liệu checklist phụ thuộc
(vd. lưu kiểm kê tồn kho).

---

## 6. UI: mở rộng / thu gọn

2 trạng thái, không có nút tắt vĩnh viễn — chỉ ẩn hẳn khi xong cả 5 bước:

- **Mở rộng** (mặc định): thẻ `fixed left-3 bottom-*` chứa nút "Đi tới ..." + checklist con của
  bước hiện tại (render bằng `<Body ctx={ctx} />` của đúng bước đó).
- **Thu gọn**: pill nhỏ `fixed left-4 bottom-4` hiện `idx+1/5`, bấm để bung lại.

Trạng thái thu/mở lưu trong `local.collapsed` (cùng `localStorage` key với checklist bước 1, theo
từng `addressId`).
