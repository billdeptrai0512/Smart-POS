-- ============================================================
-- Fix get_address_entitlement — trả MỖI module 1 dòng (mô hình 2-module).
--
-- BUG: hàm đang chạy trong DB là bản LEGACY (basic/pro) với LIMIT 1 +
-- ORDER BY tier 'pro'/'basic' → chỉ trả 1 module "tốt nhất". Hệ quả: khi 1
-- address có cả cashflow + inventory active, RPC chỉ trả cashflow → view Tồn
-- kho bị gate nhầm, badge hiện "1/2 gói".
--
-- Bản 3-module (20260603) khai báo refresh hàm này nhưng DB thực tế chưa nhận
-- → repo lệch DB. Migration này ép lại đúng định nghĩa GROUP BY tier.
--
-- IDEMPOTENT: CREATE OR REPLACE. Không đụng dữ liệu.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT tier, MAX(valid_to) AS valid_to
    FROM address_subscriptions
    WHERE address_id = p_address_id
      AND valid_from <= CURRENT_DATE
      AND valid_to   >= CURRENT_DATE
    GROUP BY tier;
$$;
