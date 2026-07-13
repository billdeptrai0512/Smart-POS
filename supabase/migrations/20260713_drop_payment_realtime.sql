-- ============================================================
-- Monetization — tắt Supabase Realtime cho address_subscriptions.
-- Đã bỏ usePaymentListener (channel subpay-*) — usePaymentPoll (poll-while-pending,
-- §7.1 MONETIZATION.md) đã xác nhận thanh toán độc lập, không cần realtime nữa.
-- Bớt 1 kênh realtime/checkout ở quy mô lớn (xem docs/MONETIZATION.md §7.1).
--
-- IDEMPOTENT: chỉ DROP khỏi publication nếu đang có.
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'address_subscriptions'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.address_subscriptions;
    END IF;
END $$;

ALTER TABLE public.address_subscriptions REPLICA IDENTITY DEFAULT;
