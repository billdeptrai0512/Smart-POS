-- ============================================================
-- Monetization — bật Supabase Realtime cho address_subscriptions
-- Để webhook SePay (Edge Function → confirm_payment → INSERT) đẩy được sự kiện
-- về frontend (usePaymentListener) → tự xác nhận mở khoá cho manager.
--
-- RLS đã có sẵn (policy addr_sub_select ở 20260511) → client chỉ nhận event của
-- address mình quản lý. Realtime tôn trọng RLS khi đã bật.
--
-- IDEMPOTENT: chỉ ADD vào publication nếu chưa có.
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'address_subscriptions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.address_subscriptions;
    END IF;
END $$;

-- REPLICA IDENTITY FULL: payload.new đầy đủ cột (address_id, tier, valid_to…)
-- để client lọc đúng event. Mặc định chỉ có PK trong payload với UPDATE/DELETE.
ALTER TABLE public.address_subscriptions REPLICA IDENTITY FULL;
