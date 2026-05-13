# Hệ thống Chi Phí — Phân tích & Roadmap

## Vấn đề gốc

**Công thức Thực thu hiện tại bị lỗi:**
```
Thực thu = TM + CK + SUM(dailyExpenses)  ← dailyExpenses là LIVE query
```
- Tại sao cộng `dailyExpenses`? Vì nhân viên rút từ két trong ca (đá, cốc, gas...) → đếm tiền cuối ca thì két thiếu → phải cộng lại để ra doanh thu thực.
- Vấn đề: thêm chi phí SAU ca → `dailyExpenses` tăng → Thực thu thay đổi → **sai thực tế**.

**Ví dụ minh hoạ:**
```
Chốt ca: TM=860k, CK=440k, Chi phí trong ca=94k → Thực thu=1394k ✅
Sau ca thêm 50k chi phí → dailyExpenses=144k → Thực thu=1444k ❌
```

---

## 4 Loại Chi Phí cần thống nhất

| # | Loại | Flag hiện tại | Thực thu | Cầm về | P&L | Tồn kho |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | **Chi phí trong ca** | `is_fixed=F, is_refill=F` | ✅ cộng | — | ✅ trừ | — |
| 2 | **Đi chợ / Mua NVL** | `is_refill=T` | ❌ | ✅ trừ | ✅ trừ | ✅ |
| 3 | **Chi phí sau ca (free-form)** | ⚠️ THIẾU | ❌ | ✅ trừ | ✅ trừ | — |
| 4 | **Chi phí cố định** | `is_fixed=T` | ❌ | ❌ | ✅ trừ | — |

### Phân biệt Loại 2 vs Loại 3

| | Đi chợ / Mua NVL | Chi phí sau ca (free-form) |
|---|---|---|
| Ví dụ | Mua đường, sữa, trà | Phí ship, mua bao bì phụ |
| Link ingredient | ✅ → cập nhật tồn kho + giá vốn | ❌ Không |
| Ảnh hưởng Thực thu | ❌ | ❌ |
| Ảnh hưởng Cầm về | ✅ trừ | ✅ trừ |

**Điểm chung**: cả 2 xảy ra SAU khi đếm tiền → gộp chung trong card "Đi chợ" trên báo cáo, nhưng phân biệt khi drill-down.

---

## Quyết định kiến trúc

### Migrate vs Backward Compat → **Backward compat + Additive**

- Giữ nguyên `is_fixed` + `is_refill` (3 loại cũ đang đúng)
- Thêm loại 3 (chi phí sau ca free-form) bằng: `is_refill=true` + `metadata: { free_form: true }`
- **Không cần DB migration**, data cũ vẫn hoạt động đúng

### Giải quyết vấn đề Thực thu

**Cách tiếp cận**: User chọn loại khi nhập chi phí (category-based, không phụ thuộc timestamp)

```
Thực thu = TM + CK + SUM(loại 1: chi phí trong ca)
Cầm về   = TM + CK - SUM(loại 2 + 3: đi chợ NVL + free-form)
P&L      = Revenue - COGS - SUM(loại 1 + 2 + 3 + 4)
```

Thực thu **stable** sau ca vì user chọn loại khi nhập, không phụ thuộc live query.

---

## UX: User chọn loại khi nhập chi phí

```
[Form nhập chi phí]
  Tên chi phí: _______
  Số tiền: _______

  Loại:
  🔴 Chi phí trong ca   ← rút từ két trong ca, cộng vào Thực thu
  🟠 Sau ca / Đi chợ    ← sau khi đếm tiền, trừ vào Cầm về
       ↳ Sub-option: [ ] Link nguyên vật liệu → cập nhật tồn kho
  🟡 Chi phí cố định    ← manager only, P&L only
```

---

## Nhật ký Chi phí thống nhất (Câu 3)

**Vấn đề hiện tại**: chi phí phân tán ở `/history`, `/expenses`, `/ingredients` — không có nơi tra cứu theo ngày.

**Giải pháp**: Tab "Chi phí" trong `/history` hoặc `/expenses` hiển thị **tất cả 4 loại** theo ngày, có filter theo loại, sorted theo thời gian.

---

## Tasks cần thực hiện

### Phase 1 — Fix công thức Thực thu
- [ ] Thêm category selector vào form nhập chi phí (ExpensePage)
  - 3 loại: Trong ca / Sau ca / Cố định
  - Default: "Trong ca" (backward compat với hành vi hiện tại)
- [ ] Lưu metadata để phân biệt: chi phí sau ca free-form = `is_refill=true, metadata.free_form=true`
- [ ] Sửa công thức trong `FinancialFlow.jsx`: Thực thu chỉ SUM loại `operational`
- [ ] Sửa `DailyReportPage.jsx` và `RangeReportPage.jsx` tương tự

### Phase 2 — Đi chợ free-form
- [ ] ExpensePage: khi chọn "Sau ca", cho phép nhập free-form (không cần link NVL)
- [ ] Optional: nếu user muốn link NVL thì show ingredient picker (reuse flow hiện tại)
- [ ] FinancialFlow "Đi chợ" card = SUM(`is_refill=true`) gồm cả NVL-linked lẫn free-form
- [ ] Drill-down phân biệt: "NVL" vs "Chi phí khác"

### Phase 3 — Nhật ký chi phí thống nhất
- [ ] `/history` hoặc tab mới: hiển thị tất cả 4 loại chi phí theo ngày
- [ ] Filter theo loại: Trong ca / Sau ca / Cố định / Mua NVL
- [ ] Có thể tra cứu theo ngày (không chỉ hôm nay)
- [ ] Đồng bộ với daily-report khi click vào từng card chi phí

---

## Ghi chú
- **Không cần "chốt sổ" button riêng** — giải quyết bằng category-based approach
- **Thực thu stable** sau ca là kết quả tự nhiên của việc user chọn loại khi nhập
- `/shift-closing` vẫn có thể edit tự do (inventory, TM, CK) mà không ảnh hưởng logic
