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
   - `20260611_phase2a_users_phone_trial_binding.sql` — `users.phone` + RPC `set_my_phone` + trigger trial bind theo SĐT (Giai đoạn A). ⚠️ Sau migration này: account chưa nhập SĐT tạo address sẽ KHÔNG có trial.
   - `20260612_fix_invoice_payment_same_day.sql` — fix `record_invoice_payment` từ chối trả nợ cùng ngày tạo hoá đơn (so sánh theo NGÀY VN thay vì timestamp; client neo 12h trưa).
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

### Giai đoạn A — thu SĐT sau khi tạo tài khoản (chưa cần OTP, chi phí 0đ) — ✅ XONG 2026-06-11
- [x] Migration `20260611_phase2a_users_phone_trial_binding.sql`: cột `users.phone` (E.164 +84) + UNIQUE index partial + RPC `set_my_phone` (chuẩn hoá, validate, xử lý trial) + trigger mới.
- [x] UI (chốt với owner): field SĐT trong **modal tạo chi nhánh** khi chưa có phone (bảo đảm phone có TRƯỚC khi trigger trial chạy — bỏ trống = không trial) + **card Tài khoản ở tab Staff** (`AccountCard.jsx`) để xem/nhập/sửa. Cả 2 ẩn mồi trial khi monetization OFF.
- [x] Trigger `grant_trial_on_address_creation`: chỉ cấp khi owner **có phone** VÀ phone **chưa có trong `trial_grants`**; bỏ check "address đầu tiên" (trial_grants = nguồn chân lý 1 SĐT = 1 trial).
- [x] Backfill: `set_my_phone` lần đầu nhập số → nếu account đã từng nhận trial thì chỉ bind vào `trial_grants` (không cấp lại); nếu có address chưa từng có gói → cấp trial 7 ngày luôn (mồi "nhập SĐT = được trial" đúng cho cả user cũ).

### Giai đoạn B — verify SĐT thật (chống nhập số bừa lấy trial)

→ **Plan chi tiết: `docs/phoneAuth.md`** (nghiên cứu 2026-06-11). Tóm tắt: hướng chính là
**Zalo Mini App** `getPhoneNumber` (0đ/lần verify — web OAuth Zalo KHÔNG trả SĐT nên bị loại);
fallback **Twilio OTP** nếu kẹt pháp nhân (xác thực OA cần hộ KD/GPKD).
⏳ Chờ owner xác nhận có hộ KD/GPKD chưa → chốt Zalo hay Twilio trước.

### Giai đoạn C — SĐT làm phương thức đăng ký (trước khi mở đăng ký tự do)
- [ ] SignUpPage: nhập SĐT → OTP → tạo tài khoản (`signInWithOtp`). Tài khoản cũ giữ username/password.
- [ ] Trigger trial đọc phone verified từ `auth.users` (không fake được).
- [ ] Khi OTP volume >100/tháng: migrate Twilio → eSMS/Stringee qua Edge Function (Phase 4 trong MONETIZATION.md §3).

*Cập nhật: 2026-06-11.*
