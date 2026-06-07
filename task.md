# Task / Reminder — Monetization

> Ưu tiên hiện tại: **thiết kế UI trước**. Chưa apply migration, chưa build payment backend.
> Nguồn chi tiết: `docs/MONETIZATION.md`.

## ⚠️ Cần chạy lên Supabase (CHƯA apply) — chạy theo thứ tự
Cả 2 đều idempotent, an toàn (prod + dev chung 1 DB). Dán vào Supabase SQL editor:

1. `supabase/migrations/20260603_realtime_address_subscriptions.sql`
   — bật Realtime cho `address_subscriptions` (để payment listener nhận event).
2. `supabase/migrations/20260606_monetization_two_modules.sql`
   — gộp 3→2 module: `finance → cashflow`, CHECK còn `('cashflow','inventory')`, trigger trial cấp 2 module.

✅ Đã apply trước đó: `20260511_monetization_phase1.sql`, `20260512_monetization_trial_trigger.sql`,
   `20260520_security_hardening.sql`, `20260603_monetization_three_modules.sql`.

**Verify sau khi chạy** (SQL editor):
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'address_subscriptions'::regclass AND contype='c';   -- CHECK phải là ('cashflow','inventory')
SELECT tier, count(*) FROM address_subscriptions GROUP BY tier;        -- không còn 'finance'
```

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
