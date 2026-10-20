# Thành phẩm, Topping & Công thức

Tài liệu này mô tả **mô hình dữ liệu và luồng tồn kho** của 3 khái niệm: công thức (món bán), thành phẩm (tự nấu theo mẻ)
và topping (bán kèm món). Đọc xong bạn trả lời được: *"Món này / topping này trừ tồn của cái gì, ở đâu, lúc nào?"*

Đọc kèm [INVENTORY_LOGIC.md](INVENTORY_LOGIC.md) (tồn kho 2 kho, đếm tay, WAC). Tài liệu này chỉ nói phần thêm vào.

> Trạng thái: **§2–§4 đã code** (nhánh `claude/wonderful-elion-4a0506`, migration `20261026` + `20261027`).
> **§5–§8 là thiết kế đã thống nhất.** Đợt 1 (schema) và đợt 2 (tiêu hao ở client) **đã code** (migration `20261028_topping_source.sql`);
> đợt 3–5 (giá vốn RPC, UI, chuyển dữ liệu) chưa.

---

## 1. Ba khái niệm — hai trục độc lập

Khách chốt (31 Nguyễn Thị Tươi): topping có 2 loại — **có sẵn** (mua sẵn, đếm tồn như nguyên liệu) và **nấu lên** (chính là
thành phẩm). Ngoài ra có **bán thành phẩm không bán kèm** (nước cốt trà sữa) — dùng trong công thức, không phải topping.

Hai câu hỏi độc lập tạo ra bốn ô:

| | Chỉ dùng trong công thức | Bán kèm món (có giá) |
|---|---|---|
| **Mua sẵn** | Nguyên liệu | Topping trỏ vào nguyên liệu |
| **Tự nấu theo mẻ** | Thành phẩm (nước cốt trà sữa) | Topping trỏ vào thành phẩm (trân châu nấu) |

→ **Thành phẩm trả lời "có tự làm không"; topping trả lời "có bán kèm không".** Không gộp hai thứ vào một bảng:
gộp lại sẽ lại lẫn như trước.

| Khái niệm | Bảng | Bán trên POS | Công thức dùng để | Tồn |
|---|---|---|---|---|
| Công thức (món) | `products` (`is_batch=false`) + `recipes` | Có, `price` | Trừ nguyên liệu khi bán + giá vốn | Không (tồn nằm ở nguyên liệu) |
| Thành phẩm | `products` (`is_batch=true`, `batch_yield`) + `recipes` | Không | Trừ nguyên liệu khi **sản xuất mẻ** | Có, đếm ở Kiểm kê |
| Topping | `toppings` + `product_toppings` | Có, kèm món | **Hiện tại:** chỉ giá vốn. **Đích:** trỏ 1 nguồn (§5) | **Hiện tại:** đếm tay, bán không trừ. **Đích:** theo nguồn |

---

## 2. Thành phẩm (đã code)

- Là 1 dòng `products` với `is_batch=true` và `batch_yield` (sản lượng **1 mẻ**, tính bằng đơn vị của thành phẩm).
  `fetchProducts` **loại** các dòng này khỏi `products` (POS/menu); chúng nằm ở `ProductContext.batchProducts`.
- **Công thức mẻ** = các dòng `recipes` của chính dòng `products` đó (số lượng nguyên liệu cho **1 mẻ**).
- Đi kèm 1 dòng `ingredient_costs` **cùng tên** (khoá = `normalizeIngredientKey(name)`). Nhờ vậy thành phẩm tự xuất hiện ở
  Kiểm kê và ở bộ chọn nguyên liệu của công thức món. `ProductContext.batchKeys` = tập các khoá này.
- Thành phẩm **chỉ làm từ nguyên liệu gốc** (bộ chọn trong công thức mẻ loại các thành phẩm khác — chưa hỗ trợ lồng).
- Món dùng thành phẩm trong công thức → bán món là **trừ thành phẩm trực tiếp** (không truy ngược về nguyên liệu gốc).
- Thành phẩm **bị loại khỏi** danh sách mua/lấy từ kho (Bổ sung tồn kho, Soạn ngày mai, Soạn kho nhóm) vì không mua được;
  thay vào đó hiện ở "Thành phẩm cần làm" (Chuẩn bị hôm nay).

## 3. Sản xuất mẻ (đã code)

Nhân viên bấm **Sản xuất** (Chuẩn bị hôm nay → "Thành phẩm cần làm", hoặc Kiểm kê → "Sản xuất hôm nay"), chọn số mẻ tuỳ ý
(0.5 / 1 / 1.5…).

```
produce_batch(p_address_id, p_product_id, p_output_ingredient, p_batches, p_staff_name)
  → 1 dòng production_batches:
      batches, output_qty = batches × batch_yield,
      inputs = jsonb snapshot [{ingredient, amount × batches}]   -- đóng băng công thức tại thời điểm làm
cancel_production_batch(p_id)  → set cancelled_at (huỷ mềm, KHÔNG xoá)
```

- Bảng `production_batches`: RLS chỉ `SELECT`; ghi **chỉ qua 2 RPC** `SECURITY DEFINER` có ownership guard.
- **Tiêu hao dạng net**, cộng chồng lên tiêu hao theo đơn lúc đọc (`src/utils/production.ts`):
  nguyên liệu gốc **+inputs**, thành phẩm **−output_qty**. **Không** ghi vào `daily_ingredient_usage` (đóng băng) — luôn
  tính lại từ `production_batches`, nên huỷ 1 mẻ là sạch ngay.
- Tồn quầy = đếm cuối + nhập thêm − tiêu hao ⇒ **RPC `get_ingredient_stocks_v2` không đổi**; phần cộng/trừ mẻ nằm ở client
  (`services/counterEstimate.ts`, `hooks/useCounterCalc.ts`).
- Lý do net: nếu làm 1 mẻ rồi đếm lại, nguyên liệu bị trừ không bị tính là "hao hụt", thành phẩm được làm ra không bị tính "dư".
- Giả định vận hành: nhân viên "Nhập thêm" nguyên liệu ra quầy **trước**, rồi mới sản xuất; sản xuất trừ ở phía quầy.

### Giới hạn đã biết
- `unit_cost` là số nguyên → thành phẩm rẻ/đơn vị (vài đồng/g) bị làm tròn.
- Lịch sử sản xuất đọc **62 ngày** (`productionRows`).
- Chế độ khách (guest/localRepository) **không hỗ trợ** thành phẩm.
- `useGroupPrep` (Soạn kho nhóm) ước tính quầy **chưa** tính sản xuất.
- Dự báo (forecast) chỉ dựa trên bán hàng; số dư tồn mới dùng tiêu hao net.

---

## 4. Topping — hiện trạng (trước đợt §5)

- Bảng `toppings` (toàn cục theo địa chỉ), công thức riêng `topping_ingredients`, gắn món qua `product_toppings`,
  `order_items.topping_ids` lưu topping đã chọn.
- `topping_ingredients` **chỉ để tính giá vốn** trong `bulk_create_orders` — **không trừ tồn**.
- `insertTopping` tạo kèm 1 dòng `ingredient_costs` cùng tên → topping hiện ở Kiểm kê, nhưng tồn **chỉ đếm tay**.
  Bán topping **không** làm tồn đó giảm: `calculateEstimatedConsumption` chỉ đọc `extras`, không đọc `toppings`.
- Hệ quả: topping nấu (trân châu) hiện phải tạo **hai lần** (topping + thành phẩm), hai công thức, và tồn lý thuyết
  của thành phẩm sẽ **cao hơn thực tế** nếu nó cũng được bán như topping (bị coi là hao hụt).

---

## 5. Thiết kế đích: Topping là "lớp bán hàng" trỏ vào 1 nguồn

Topping **không còn công thức và không còn tồn riêng**. Nó chỉ có: tên, giá cộng thêm, món được gắn, và

```
toppings.source_ingredient  TEXT     -- khoá nguyên liệu (nguyên liệu mua sẵn HOẶC thành phẩm, cùng key ingredient_costs)
toppings.source_amount      NUMERIC  -- lượng nguồn cho 1 phần topping (vd 30 g)
```

- **Topping có sẵn** → nguồn là nguyên liệu. **Topping nấu** → nguồn là thành phẩm. Cùng một cơ chế.
- **Hai loại topping, cùng một cơ chế** (khác nhau chỉ ở nguồn là nguyên liệu hay thành phẩm). Thời điểm trừ tồn:

  | | Lúc nào | Trừ cái gì |
  |---|---|---|
  | Topping có sẵn (nguồn = nguyên liệu) | Lúc **bán** | Trừ thẳng nguyên liệu: `source_amount × số lượng` |
  | Topping nấu (nguồn = thành phẩm) | Lúc **sản xuất mẻ** (§3) | Trừ nguyên liệu gốc theo công thức mẻ, cộng thành phẩm |
  | | Lúc **bán** | Trừ tồn thành phẩm: `source_amount × số lượng` (theo từng phần, **không** theo mẻ) |

  Kiểm kê thành phẩm đếm số còn lại sau cả hai bước. Code bán hàng không cần biết nguồn thuộc loại nào.
- **Bán topping** (mỗi `topping_ids[i]` × số lượng món) → tiêu hao `source_amount × qty` của `source_ingredient`.
- **Giá vốn topping** = `source_amount × ingredient_costs.unit_cost(source_ingredient)`.
- Tạo topping KHÔNG còn tự sinh dòng `ingredient_costs` cùng tên (nguồn đã là một dòng tồn có sẵn).
- **Một nguồn / topping** (cố ý). Cần nhiều nguồn (trân châu + đường) → tạo thành phẩm "trân châu đường" để gom lại.
- Sheet "+" (đã có): *Món bán / Thành phẩm / Topping*. Form Topping sẽ thêm bước **chọn nguồn + định lượng 1 phần**.

### Tương thích ngược (bắt buộc để rollout an toàn)
Topping **chưa có `source_ingredient`** giữ nguyên hành vi cũ (giá vốn theo `topping_ingredients`, không trừ tồn).
Mỗi quán chuyển dần từng topping; không có "ngày chuyển đổi" toàn hệ thống.

---

### Cách đợt 2 cài (quan trọng khi đọc code)
Nguồn của topping được đưa vào **cùng map với extras**: `fetchToppingSources()` trả `{ [toppingId]: [{ ingredient: source, amount: source_amount }] }`,
`fetchExtraIngredientsWithToppings()` gộp nó vào map `extraIngredients` (key = id extra hoặc id topping, UUID nên không trùng).
`orderItemsOf` đưa `topping_ids` (hoặc `toppings` của đơn offline) vào danh sách `extras` của dòng. Nhờ vậy **không đổi chữ ký**
của `calculateEstimatedConsumption` / `usageByDay` / `counterEstimate`… — mọi nơi đang tính tiêu hao tự có tiêu hao topping.
Hệ quả cần nhớ: topping hiện trong `calculateConsumptionBreakdown` như một biến thể extra; `buildRecipeIngredientSet` coi nguồn là nguyên liệu có trong công thức.

## 6. Các điểm chạm khi code (checklist)

| Việc | Vị trí | Ghi chú |
|---|---|---|
| Cột mới | migration mới trên `toppings` | `ADD COLUMN IF NOT EXISTS`, nullable. Không đụng function → không vướng rule search_path. |
| Tiêu hao khi bán | `src/utils/inventory.ts` → `calculateEstimatedConsumption` | Thêm bước 3 đọc `item.toppings`/`topping_ids` × `source_*`. Cần truyền map topping vào (như `extraIngredients`). |
| Dữ liệu đầu vào | `orderItemsOf` + các select `order_items(...)` | Hiện `reportService.ts` (~L278, L328) và `orderService.ts` (~L361) **không select `topping_ids`** — phải thêm, nếu không tiêu hao topping = 0. |
| Caller của tiêu hao | `utils/dailyUsage.ts`, `rangeCalc`, `DailyReportPage`, `PastInventoryEditor`, `RangeLossCard`, `usePrepNotice`, `InventoryAuditTab` | Cùng chữ ký — nên đổi qua 1 tham số gộp (`consumptionCtx`) thay vì thêm tham số thứ 4. |
| Giá vốn | RPC `bulk_create_orders` (bản mới nhất: `20261026_discount_program_table_scope.sql`) | Vòng COGS topping đổi từ `topping_ingredients` sang `source_amount × unit_cost`, fallback cũ khi `source_ingredient IS NULL`. **Giữ `SET search_path = public`, ownership guard, REVOKE/GRANT** (xem CLAUDE.md). `npm run check:search-path`. |
| Giá vốn client | `POSContext` (~L503, tính lạc quan) | Phải khớp RPC; server mới là nguồn thật. |
| Đóng băng | `daily_ingredient_usage` | Ngày **đã đóng băng** giữ số cũ (không có tiêu hao topping). Chỉ ngày mới tính đúng. Không tự ghi lại lịch sử. |
| Form/UI | `CreateToppingForm`, `RecipeMenuPage` (bộ lọc `?kind=main|batch|topping`), `RecipeIngredientPage` + `useToppingDetail` (1 trang chi tiết cho cả món, thành phẩm, topping; nhánh topping trả sớm ở đầu phần render) | Thay phần "Công thức" của nhánh topping bằng "Nguồn + định lượng"; vẫn giữ `ProductLinksSection`. Route cũ `/category/toppings` và `/category/toppings/:id` còn lại để tương thích. |
| Sao chép/sao lưu | `backupService`, `exportService`, `importService`, `ExcelImportModal`, RPC `bulk_import_menu*`, `clone_full_config`, `localRepository` | Đều tham chiếu `toppings`/`topping_ingredients` — thêm 2 cột mới, kẻo clone chi nhánh mất nguồn. |
| Xoá nguyên liệu | RPC `delete_ingredient` | Nguyên liệu/thành phẩm đang là nguồn của topping → chặn hoặc cảnh báo. |

---

## 7. Lộ trình triển khai

Mỗi đợt tự đứng được, deploy riêng. Migration **apply tay trong Supabase SQL editor TRƯỚC khi deploy client**.

0. **Chốt thành phẩm** (đang làm): apply `20261026_batch_products.sql` + `20261027_production_batches.sql`, rồi deploy.
   *Thí điểm tại 31 Nguyễn Thị Tươi* — xem §8.
1. ✅ **Schema**: thêm `toppings.source_ingredient`, `source_amount` (nullable, CHECK cặp). Không đổi hành vi.
2. ✅ **Tiêu hao client** (test: `src/utils/toppingUsage.test.ts`): `calculateEstimatedConsumption` đọc topping có nguồn + select thêm `topping_ids`. Có test đơn vị.
   Topping chưa có nguồn → không đổi. (Đây là đợt kiểm chứng số liệu.)
3. **Giá vốn RPC**: `bulk_create_orders` + khớp `POSContext`. Có fallback.
4. **UI**: form Topping (chọn nguồn + định lượng), bỏ công thức topping cho topping đã có nguồn.
5. **Di chuyển dữ liệu** từng quán: gán nguồn cho từng topping (hỏi chủ quán định lượng 1 phần). Cuối cùng mới cân nhắc bỏ `topping_ingredients`.

> Đợt 2 trước đợt 3 cố ý: trừ tồn sai chỉ lệch số đếm (sửa được bằng kiểm kê), còn giá vốn sai ghi vào `order_items.unit_cost`
> **vĩnh viễn** — nên làm sau cùng khi đã tin số liệu.

## 8. Thí điểm: 31 Nguyễn Thị Tươi

Chi nhánh dùng bộ tính năng phức tạp này đầu tiên (nhân viên: Hồ Nhựt Huy). Khi triển khai:

- **Không xoá/sửa hàng loạt dữ liệu thật** của chi nhánh; dọn dữ liệu thử bằng đúng id đã tạo + huỷ mềm
  (`cancel_production_batch`), không quét theo địa chỉ + ngày.
- Làm theo thứ tự: tạo 1 thành phẩm thật (vd trân châu) → chạy 1–2 ngày xem tồn lý thuyết quầy có khớp đếm tay không
  → mới gán topping vào nguồn (đợt 4–5).
- Trước khi gán nguồn cho topping, **hỏi quán**: 1 phần = bao nhiêu g/ml; topping nào là có sẵn, topping nào là nấu.
- Soát lại sau 1 tuần: cột Hao hụt của thành phẩm không được lệch hệ thống (dấu hiệu quên "Sản xuất" hoặc định lượng sai).

## 9. Câu hỏi còn mở
- Một topping cần nhiều nguồn (hiện: gom bằng thành phẩm). Có đủ cho các quán khác ngoài 31 NTT không?
- Thành phẩm lồng thành phẩm (nước cốt dùng trong trân châu)? Hiện chưa hỗ trợ.
- Lịch sử đã đóng băng không có tiêu hao topping — có cần công cụ tính lại 1 lần khi chuyển nguồn không?
