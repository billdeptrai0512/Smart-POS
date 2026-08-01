# Onboarding Guide ("Bắt đầu bán hàng")

Tài liệu này mô tả widget hướng dẫn 7 phase hiện ở góc trái màn hình cho user mới (guest
mode). Đọc xong bạn sẽ trả lời được: *"Guide đang tính phase nào là phase hiện tại, và muốn
sửa/thêm 1 phase thì sửa ở đâu?"*

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

## 2. Cấu trúc file — mỗi phase 1 file

```
src/components/common/onboarding/
├── OnboardingGuide.jsx     ← shell: fetch data dùng chung, chọn phase active, render khung/pill
├── ChecklistRow.jsx        ← 1 dòng checklist dùng chung (label + tick)
└── steps/
    ├── orderStep.jsx             (1) Tạo đơn
    ├── journalStep.jsx           (2) Nhật ký
    ├── cashReportStep.jsx        (3) Báo cáo dòng tiền
    ├── inventoryStep.jsx         (4) Kiểm kê tồn kho
    ├── recipeStep.jsx            (5) Điều chỉnh công thức
    ├── mainStockStep.jsx         (6) Tồn kho nguyên liệu (gộp cả bao bì, không tách riêng nữa)
    └── ingredientCoffeeStep.jsx  (7) Nguyên liệu (cà phê)
```

Khi xong cả 7 phase, `OnboardingGuide.jsx` không unmount nữa — nó chuyển sang render
`FINISHED_STEP` (khai báo ngay trong `OnboardingGuide.jsx`, không phải 1 file `steps/` vì
không gắn với `done()`/`ctx` nào): panel với CTA "Đăng ký tài khoản" → `/signup`.

Mỗi file trong `steps/` export **default 1 object**:

```js
export default {
    to: '/route',           // navigate() tới đâu khi bấm nút
    state: {...},           // (optional) state kèm theo navigate
    navLabel: 'Đi tới ...',
    name: 'Tên pill',       // label hiện trên pill thu gọn + checklist header
    done: (ctx) => boolean, // logic: phase này xong chưa?
    Body: ({ ctx }) => JSX, // UI: render checklist con của riêng phase này
}
```

`ctx` là 1 object dữ liệu dùng chung do `OnboardingGuide` build 1 lần mỗi render (xem §4), truyền
xuống cho `done()` và `<Body>` của **mọi** phase — không phải mỗi phase tự fetch riêng.

Muốn sửa nội dung/điều kiện của 1 phase → chỉ sửa đúng 1 file trong `steps/`, không đụng shell.
Muốn thêm phase 8 → thêm file mới theo khuôn trên rồi chèn vào mảng `STEPS` trong
`OnboardingGuide.jsx`.

---

## 3. Cách chọn phase hiện tại

```js
const STEPS = [orderStep, journalStep, cashReportStep, inventoryStep, recipeStep, mainStockStep, ingredientCoffeeStep]
const idx = STEPS.findIndex(s => !s.done(ctx))
const step = idx === -1 ? FINISHED_STEP : STEPS[idx]   // xong cả 7 phase → CTA đăng ký tài khoản
```

Phase hiện tại = phase **chưa done đầu tiên**, theo đúng thứ tự khai báo. Không có khái niệm "bỏ
qua 1 phase" — nếu phase 2 chưa xong, dù phase 3-7 đã xong, widget vẫn đứng ở phase 2.

---

## 4. 7 phase và điều kiện "done"

Mọi cờ tiến độ (trừ phase 6/7, đọc thẳng từ tồn kho) là **localStorage, theo action thật, không
bao giờ revert về `false`** — một khi tick, phase coi như xong vĩnh viễn cho address đó, kể cả khi
dữ liệu (ví dụ `shift_closings` của "hôm nay") reset qua ngày mới. Trigger theo hành động thật
(gõ/chuyển tab/giữ item) chứ không phải bước submit sau đó, vì model 1-tap của POS khiến "submit"
lag 1 tap sau hành động thật — tick theo submit sẽ đọc như checklist bị kẹt.

| # | Phase | File | Điều kiện done | Trigger ghi cờ |
|---|---|---|---|---|
| 1 | Tạo đơn | `orderStep.jsx` | `orderProgress`: giữ Cà phê sữa + giữ Cacao Cà Phê (Lớn) + giữ Matcha Cà Phê. `viewedHistory` không còn gate bước này (chỉ lái hint sang phase 2), tránh cảm giác kẹt 2/2 khi user chưa ghé `/history` | [useOrderOnboardingProgress.js](../src/hooks/useOrderOnboardingProgress.js), viết từ `POSPage.jsx` |
| 2 | Nhật ký | `journalStep.jsx` | `journalProgress`: xem tab Thu nhập + Chi phí + Báo cáo (tab bar `/history`) | `HistoryPage.jsx`, viết khi đổi tab |
| 3 | Báo cáo dòng tiền | `cashReportStep.jsx` | `cashFlowProgress`: đã **lưu** "Thực thu" với ô Tiền mặt VÀ ô Chuyển khoản đều có gõ gì đó (độc lập, không theo thứ tự) | `DailyReportPage.jsx`, viết trong `handleSaveCashflow` sau khi lưu thành công |
| 4 | Báo cáo tồn kho | `inventoryStep.jsx` | `inventoryProgress`: đã **lưu** kiểm kê tồn kho với Cuối kỳ có gõ gì đó cho nguyên liệu "Cà phê" và "Cacao" (match theo label, không hardcode key), mỗi cái tính riêng | `DailyReportPage.jsx`, viết trong callback sau khi lưu kiểm kê thành công |
| 5 | Điều chỉnh công thức | `recipeStep.jsx` | `recipeProgress`: đã điền định lượng (`amount > 0`) VÀ tạo "tùy chọn thêm" cho đúng công thức "Cà phê đen" (match theo tên món). Không có nút nav riêng trong panel guide — xem hint mũi tên header ngay dưới | `RecipeIngredientPage.jsx`, render-time-adjust theo `prodRecipes`/`extras` |
| 6 | Tồn kho nguyên liệu | `mainStockStep.jsx` | 100% nguyên liệu (gồm cả bao bì, không tách category nữa) có `warehouse_stock_set` **và** `counter_stock_set` | `fetchIngredientStocks()` → RPC `get_ingredient_stocks_v2` |
| 7 | Nguyên liệu (cà phê) | `ingredientCoffeeStep.jsx` | `stockProgress.coffeeWarehouseSet` — dùng lại đúng field `warehouse_stock_set` của phase 6, lọc riêng ingredient "Cà phê" | như phase 6 — **thuần bước điều hướng/UI**, có thể đã done sẵn từ phase 6, guide chỉ lướt qua nhanh chứ không chặn |

> [!IMPORTANT]
> Phase 6/7 dùng cờ `warehouse_stock_set` / `counter_stock_set` (không phải `> 0`) để phân biệt
> "chưa từng nhập" với "nhập bằng 0". Cờ này chỉ có từ migration
> `20260720_ingredient_stocks_set_flags.sql` — trước đó cả 2 case đều collapse về `0` qua
> `COALESCE`, khiến checklist không bao giờ báo done nếu tồn thực = 0. Xem
> [INVENTORY_LOGIC.md](INVENTORY_LOGIC.md) để hiểu sâu hơn cách 2 kho được suy ra.

Song song với "done" gate, `OnboardingGuide` còn spotlight UI element kế tiếp cần bấm/gõ qua class
CSS `onboarding-hint` (animation ở `src/index.css`) — xem
[onboardingHint.js](../src/utils/onboardingHint.js) (`onboardingHintClass`, `norm`). Mỗi trang tự
tính hint boolean cục bộ từ đúng `*Progress` object của phase đang active trên trang đó (ví dụ
`CashFlowCard`/`InventoryReportCard`/`ReportViewFilter` ở `DailyReportPage.jsx`; `ProductCard` ở
`RecipeMenuPage.jsx` + phần `FastIngredientFill`/`ExtrasSection` ở `RecipeIngredientPage.jsx`;
`IngredientCostItem` ở `IngredientManagementPage.jsx` + `QtyRow` ở `IngredientDetailsTab.jsx`),
không đọc từ `ctx` của `OnboardingGuide` (2 component khác nhau, chỉ chia sẻ qua `localStorage`).

Phase 5 là ca đặc biệt: không có nút "Đi tới ..." riêng trong panel guide (không set `navLabel`).
Thay vào đó, mũi tên "tiến" có sẵn ở `HistoryHeader` (nút `onForward`, dùng chung bởi
`/history` và `/daily-report`, đi xuyên page theo [menuSequence.js](../src/utils/menuSequence.js))
được gắn hint (`hintForward` prop) khi phase 4 đã xong nhưng phase 5 thì chưa — tính ở
`DailyReportPage.jsx`/`HistoryPage.jsx`. Bấm mũi tên đó đưa thẳng tới `/recipes`, nơi
`ProductCard`/`FastIngredientFill`/`ExtrasSection` tiếp quản chuỗi hint.

---

## 5. `ctx` — dữ liệu shell truyền xuống từng phase

Build trong `OnboardingGuide.jsx` mỗi lần render (sau khi `reload()` fetch xong):

```js
const ctx = { ...local, stockProgress, totalAll: stockProgress.totalAll }
```

`local` = toàn bộ object đọc từ `localStorage` (`onboarding_v4_<addressId>`, xem
[onboardingStorage.js](../src/utils/onboardingStorage.js)): `orderProgress`, `journalProgress`,
`cashFlowProgress`, `inventoryProgress`, `recipeProgress`, `collapsed`. `stockProgress` (gồm
`allWarehouse`/`allCounter`/`totalAll` — gộp chung main + bao bì — và `coffeeWarehouseSet` cho
phase 7, tất cả tính trong cùng 1 lần quét `ingredientConfigs`) đến từ `reload()`.

`reload()` gọi **1 API duy nhất** (`fetchIngredientStocks`), chạy lại khi: đổi `addressId`, đổi
`ingredientConfigs`, tab quay lại foreground (`visibilitychange`), hoặc trang khác gọi
`requestRefresh()` từ `useOnboardingVisibility()` sau khi vừa ghi 1 `*Progress` flag (qua
[useOnboardingProgressPersist.js](../src/hooks/useOnboardingProgressPersist.js), shared bởi phase
1-4 và 6). Phase 1-4 và 6 tự đọc/ghi `*Progress` trực tiếp trong `local` — không qua fetch riêng.
Phase 7 không có `*Progress` riêng — dùng lại `stockProgress.coffeeWarehouseSet` từ phase 6.

---

## 6. UI: mở rộng / thu gọn

2 trạng thái, không có nút tắt vĩnh viễn, và **không còn ẩn hẳn** khi xong hết — xong cả 7 phase
thì `step` chuyển thành `FINISHED_STEP` (CTA "Đăng ký tài khoản" → `/signup`) thay vì unmount:

- **Mở rộng** (mặc định): thẻ `fixed left-3 bottom-*` chứa nút "Đi tới ..." + checklist con của
  phase hiện tại (render bằng `<Body ctx={ctx} />` của đúng phase đó).
- **Thu gọn**: pill nhỏ `fixed left-4 bottom-4` hiện tên phase hiện tại, bấm để bung lại.

Trạng thái thu/mở lưu trong `local.collapsed` (cùng `localStorage` key với các `*Progress`, theo
từng `addressId`).
