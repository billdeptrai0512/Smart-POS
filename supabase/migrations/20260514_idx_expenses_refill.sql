-- Partial index để tăng tốc query Đi chợ (is_refill = true) theo address + thời gian.
-- Index nhỏ vì chỉ chứa rows refill, phục vụ cả range Daily/Weekly/Monthly.
CREATE INDEX IF NOT EXISTS idx_expenses_refill_addr_time
    ON expenses (address_id, created_at)
    WHERE is_refill = true;
