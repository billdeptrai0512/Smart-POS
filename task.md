# Task / Reminder — Monetization

> Ưu tiên hiện tại: **thiết kế UI trước**. Chưa build payment backend.
> Nguồn chi tiết: `docs/MONETIZATION.md`.

## ✅ Migration — đã apply hết (2026-06-08)
Toàn bộ migration monetization đã chạy lên Supabase. Verify đạt: `address_subscriptions_tier_check`
= `CHECK (tier IN ('cashflow','inventory'))`; bảng sub/intent đang rỗng (chưa bán gói nào).

Đã apply: `20260511_monetization_phase1.sql`, `20260512_monetization_trial_trigger.sql`,
`20260520_security_hardening.sql`, `20260603_monetization_three_modules.sql`,
`20260603_realtime_address_subscriptions.sql`, `20260606_monetization_two_modules.sql`.

## ⚠️ Cần chạy lên Supabase (CHƯA apply)
1. `supabase/migrations/20260608_admin_set_subscription.sql`
   — RPC `admin_set_subscription` (mở khoá thủ công cho admin). An toàn: chỉ tạo function.
2. Set role admin cho tài khoản của bạn (chạy khi đang đăng nhập):
   `UPDATE users SET role = 'admin' WHERE auth_id = auth.uid();`

## Trạng thái flag
- Local `.env`: `VITE_MONETIZATION_ENABLED=true` (để build/xem UI gate).
- Prod: vẫn **OFF** (chưa charge ai). `.env` gitignore nên không lẫn lên repo.

## Còn lại (làm sau, không phải bây giờ)
- [ ] **Server-side kill switch** đọc `app_config` (flip không cần redeploy) — làm TRƯỚC public.
- [ ] **Admin reconciliation** (đối soát thủ công) — cứu edge case webhook mất = mất tiền thật.
- [ ] **Phase 2**: Phone OTP → bind trial vào SĐT.
- [ ] **Phase 3 (c + a)**: Edge Function `sepay-webhook` + RPC `confirm_payment` + `create_payment_intent` + QR;
      đổi `usePaymentListener` (realtime placeholder) → **poll-while-pending** (xem MONETIZATION.md §7.1).
      ⏳ Chỉ làm khi mở khoá tay bằng admin trở nên cực (>~20–30 lượt/tuần). Trước đó mở tay là đủ.

*Cập nhật: 2026-06-06.*
