# Test logic tiền ở tầng SQL (staging + assert) — TASK

> Thêm 2026-07-03, từ đợt review hạ tầng.

## Vấn đề

200 unit test hiện tại (vitest) toàn utils JS thuần. Còn logic **tiền thật** — WAC (giá vốn
trung bình), `cash_phase` (trong ca / sau chốt), cascade tồn kho khi backdate/sửa/hủy phiếu —
sống trong các RPC Postgres và **không test nào chạm tới**:

- `process_ingredient_restock` — nhập kho, WAC moving-average, payment + cash_phase
- `edit_ingredient_restock` — sửa phiếu tại chỗ, WAC full re-average, cascade after_stock
- `cancel_restock` — hủy phiếu, hoàn tồn + tiền, WAC re-average
- `record_invoice_payment` — trả nợ NCC, paid_at + cash_phase độc lập với hoá đơn gốc

Git log đầy "fix tồn kho neo sai", "fix WAC" — loại regression này chỉ chặn được bằng test
chạy trên DB thật, vì bug nằm ở SQL chứ không ở JS. Thêm nữa: hiện migration được áp thẳng
lên production (không có staging) — mỗi lần DROP/CREATE function là một lần đánh cược.

## Việc cần làm

- [ ] **Supabase project staging** (free tier) — `supabase link` + `supabase db push` toàn bộ
  `supabase/migrations/`. Từ nay: migration áp staging TRƯỚC, chạy test, rồi mới áp prod.
- [ ] **Seed script** (`scripts/seed-staging.js` hoặc SQL): 1 user manager + 1 address +
  2 nguyên liệu (1 có pack_size, 1 không) + vài phiếu nhập/rút mẫu.
- [ ] **Script assert** (node script gọi RPC qua supabase-js bằng key staging, hoặc pgTAP):
  chuỗi nhập kho → sửa phiếu → hủy phiếu, mỗi bước assert tồn kho + WAC + owing khớp số
  tính tay. ~10 case đầu tiên:
  1. Nhập kho lần đầu → WAC = amountDue/qty, tồn warehouse đúng.
  2. Nhập lần 2 giá khác → WAC moving-average đúng công thức process.
  3. Sửa phiếu cũ (đổi qty + tiền) → WAC **full re-average** (mô hình cancel_restock,
     KHÔNG phải moving-average — xem chú thích trong task.md về 2 mô hình WAC).
  4. Sửa phiếu → cascade `before_stock`/`after_stock` các phiếu SAU nó đổi đúng delta.
  5. Hủy phiếu giữa chuỗi → tồn + WAC + hoàn tiền đúng.
  6. Nhập backdate (purchaseDate quá khứ, kèm giờ) → `created_at`/`paid_at` khớp,
     không vi phạm `chk_payment_paid_at_not_before_created`.
  7. Trả 1 phần (paid < amountDue) → owing đúng; trả nợ tiếp bằng `record_invoice_payment`
     → owing về 0, không âm.
  8. `cash_phase='in_shift'` tiền mặt → vào Thực thu báo cáo; `post_close`/CK → không.
  9. Trả nợ với `paid_at` tuỳ chọn (giờ trả) → rơi đúng ngày VN trong báo cáo range.
  10. Guest/local mode parity: cùng chuỗi thao tác trên localRepository ra cùng con số
      (case này chạy bằng vitest thuần, không cần DB).
- [ ] **CI**: GitHub Action chạy script assert trên staging khi PR đụng `supabase/migrations/`
  hoặc `src/services/ingredientService.js`.

## Acceptance

- Chạy `node scripts/test-money-staging.js` (hoặc lệnh tương đương) → 10/10 case pass
  trên staging sạch (script tự seed + tự dọn).
- Migration mới nào làm lệch WAC/tồn/owing → CI đỏ trước khi lên prod.

## Lưu ý

- KHÔNG chạy script này trỏ vào prod — script phải check URL/project-ref trước khi chạy.
- pgTAP là lựa chọn "chuẩn" nhưng node script + supabase-js rẻ hơn và test được cả tầng
  PostgREST (đúng đường client đi thật). Bắt đầu bằng node script.
