# Task / Reminder — Monetization

> Ưu tiên hiện tại: **thiết kế UI trước**. Chưa build payment backend.
> Nguồn chi tiết: `docs/MONETIZATION.md`.

## ✅ Migration — đã apply hết (2026-06-08)
Toàn bộ migration monetization đã chạy lên Supabase. Verify đạt: `address_subscriptions_tier_check`
= `CHECK (tier IN ('cashflow','inventory'))`; bảng sub/intent đang rỗng (chưa bán gói nào).

Đã apply: `20260511_monetization_phase1.sql`, `20260512_monetization_trial_trigger.sql`,
`20260520_security_hardening.sql`, `20260603_monetization_three_modules.sql`,
`20260603_realtime_address_subscriptions.sql`, `20260606_monetization_two_modules.sql`,
`20260608_admin_set_subscription.sql` (RPC admin set/reset),
`20260609_fix_get_address_entitlement_multimodule.sql` (fix: trả mỗi module 1 dòng).

## ⚠️ Việc cần làm trên Supabase
1. **Chạy migration (theo thứ tự, bỏ qua file đã chạy rồi):**
   - `20260609_admin_set_app_config.sql` — RPC cho nút toggle admin (server kill switch).
   - `20260609_single_plan_all_access.sql` — gộp về 1 gói `tier='all'`, trial 7 ngày, convert data test cũ.
   - `20260610_sepay_payment_webhook.sql` — RPC `create_payment_intent` + `confirm_payment` (webhook SePay).
   - `20260611_confirm_payment_killswitch_intent_expiry.sql` — `confirm_payment` check server kill switch (OFF → không ghi sub) + cron pg_cron dọn intent pending quá hạn mỗi giờ.
2. Set role admin cho tài khoản của bạn (chạy khi đang đăng nhập):
   `UPDATE users SET role = 'admin' WHERE auth_id = auth.uid();`
3. **Bật/tắt monetization runtime** (server kill switch, KHÔNG cần redeploy) — hoặc dùng nút toggle ở /addresses:
   `UPDATE app_config SET value = 'true'  WHERE key = 'monetization_enabled';`  -- bật
   `UPDATE app_config SET value = 'false' WHERE key = 'monetization_enabled';`  -- tắt (mọi thứ mở khoá)

## Mô hình giá (2026-06-09)
**1 gói all-access**: `tier='all'`, 888,888đ / 6 tháng / địa chỉ → mở cả 3 view (Dòng tiền + Lợi nhuận + Tồn kho).
Bỏ bán lẻ module, bỏ chu kỳ tháng/năm, bỏ bundle. Trial 7 ngày. Multi-branch = × số chi nhánh.

## Trạng thái flag (2 tầng — hiệu lực = client AND server)
- **Client** `.env` `VITE_MONETIZATION_ENABLED` = master capability build-time. `true` ở local.
  Build `false` → tắt cứng, không hỏi server.
- **Server** `app_config.monetization_enabled` = công tắc runtime (flip bằng UPDATE, không redeploy).
  ⚠️ Hiện seed = `'false'` → muốn test gate ở local phải UPDATE thành `'true'`.

## Còn lại (làm sau, không phải bây giờ)
- [x] **Server-side kill switch** đọc `app_config` runtime (flip không cần redeploy). `useMonetizationEnabled()` trong `useEntitlement.js`; mọi consumer (gate/badge/route/listener) dùng enabled runtime.
- [~] **Admin reconciliation**: RPC `admin_set_subscription` + `admin_reset_subscription` + nút admin trong SubscriptionPanel. Còn lại: dashboard đối soát `payment_intents` (cần trước khi public — xử lý ca `manual_review`/webhook mất).
- [ ] **Phase 2**: thêm SĐT vào tài khoản → bind trial vào SĐT. Plan 3 giai đoạn bên dưới.
- [x] **Phase 3 (c + a)** — xong 2026-06-10: Edge Function `sepay-webhook` (HMAC) + RPC `confirm_payment` + `create_payment_intent` + QR SePay + `usePaymentPoll` (poll-while-pending, chạy kèm realtime listener).
      Còn việc vận hành: deploy function + set secret + đăng ký URL webhook với SePay.

## Phase 2 — Thêm SĐT vào tài khoản (plan 3 giai đoạn, 2026-06-11)

> Mục tiêu: 1 SĐT = 1 trial duy nhất. Vá 2 lỗ hiện tại: tạo tài khoản mới nhận trial lại,
> và xoá địa chỉ → tạo lại nhận trial lại (trigger hiện chỉ đếm số address của manager).

### Giai đoạn A — thu SĐT sau khi tạo tài khoản (chưa cần OTP, chi phí 0đ)
- [ ] Migration: thêm cột `phone` (TEXT, chuẩn hoá +84) vào bảng `users` + UNIQUE index (partial, `WHERE phone IS NOT NULL`).
- [ ] UI: modal một lần sau đăng nhập cho manager chưa có phone + field trong trang tài khoản. Mồi: "Nhập SĐT để nhận 7 ngày dùng thử" — không ép.
- [ ] Sửa trigger `grant_trial_on_address_creation`: chỉ cấp trial khi manager **có phone** VÀ phone **chưa có trong `trial_grants`** (bảng có sẵn từ `20260511`, chưa được nối); cấp xong INSERT `trial_grants(phone, address_id)`.
- [ ] Backfill: tài khoản cũ đã nhận trial → khi họ nhập phone, ghi vào `trial_grants` luôn (không nhận thêm lần nữa).

### Giai đoạn B — verify SĐT bằng OTP (khi cần chống số ảo)
- [ ] Bật Phone provider (Twilio) trong Supabase Auth (~1.200đ/SMS, ổn khi <100 OTP/tháng).
- [ ] Verify số đã nhập: `supabase.auth.updateUser({ phone })` + `verifyOtp` → phone verified gắn vào `auth.users`, **không đổi cách đăng nhập** hiện tại.

### Giai đoạn C — SĐT làm phương thức đăng ký (trước khi mở đăng ký tự do)
- [ ] SignUpPage: nhập SĐT → OTP → tạo tài khoản (`signInWithOtp`). Tài khoản cũ giữ username/password.
- [ ] Trigger trial đọc phone verified từ `auth.users` (không fake được).
- [ ] Khi OTP volume >100/tháng: migrate Twilio → eSMS/Stringee qua Edge Function (Phase 4 trong MONETIZATION.md §3).

*Cập nhật: 2026-06-11.*
