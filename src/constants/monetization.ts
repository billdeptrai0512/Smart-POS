// ─── Monetization — 1 gói all-access duy nhất ────────────────────────────────
// Single source of truth cho UI checkout. Khớp docs/MONETIZATION.md §1.
//
// 1 gói duy nhất mở khoá CẢ 3 view báo cáo (Dòng tiền + Lợi nhuận + Tồn kho).
// Giá trị `tier` trong DB cho gói này = 'all'.

/** Giá trị tier lưu trong address_subscriptions cho gói all-access. */
export const ALL_TIER = 'all'

/** Gói duy nhất: 88.888đ / tháng / 1 địa chỉ, full tính năng. */
export const PLAN = {
    months: 1,
    price: 88888,
    label: 'Trọn bộ',
    periodLabel: '1 tháng',
}

/**
 * Thông tin nhận chuyển khoản (mở khoá thủ công, giai đoạn chưa có webhook).
 * ⚠️ ĐỔI THÀNH STK THẬT của bạn trước khi public.
 */
export const BANK_INFO = {
    bank: 'MB BANK',
    accountNumber: '0902822192',
    accountName: 'NGUYEN THIEN BANG',
}
