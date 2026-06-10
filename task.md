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
1. **Chạy migration (theo thứ tự):**
   - `20260609_admin_set_app_config.sql` — RPC cho nút toggle admin (server kill switch).
   - `20260609_single_plan_all_access.sql` — gộp về 1 gói `tier='all'`, trial 7 ngày, convert data test cũ.
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
- [~] **Admin reconciliation**: RPC `admin_set_subscription` + `admin_reset_subscription` + nút admin trong SubscriptionPanel. Còn lại: dashboard đối soát `payment_intents` (hoãn tới Phase 3).
- [ ] **Phase 2**: Phone OTP → bind trial vào SĐT.
- [ ] **Phase 3 (c + a)**: Edge Function `sepay-webhook` + RPC `confirm_payment` + `create_payment_intent` + QR;
      đổi `usePaymentListener` (realtime placeholder) → **poll-while-pending** (xem MONETIZATION.md §7.1).
      ⏳ Chỉ làm khi mở khoá tay bằng admin trở nên cực (>~20–30 lượt/tuần). Trước đó mở tay là đủ.

*Cập nhật: 2026-06-09.*
