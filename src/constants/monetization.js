// ─── Monetization — 1 gói all-access duy nhất ────────────────────────────────
// Single source of truth cho UI checkout. Khớp docs/MONETIZATION.md §1.
//
// 1 gói duy nhất mở khoá CẢ 3 view báo cáo (Dòng tiền + Lợi nhuận + Tồn kho).
// Giá trị `tier` trong DB cho gói này = 'all'.

/** Giá trị tier lưu trong address_subscriptions cho gói all-access. */
export const ALL_TIER = 'all'

/** Gói duy nhất: 888,888đ / 6 tháng / 1 địa chỉ. */
export const PLAN = {
    months: 6,
    price: 888888,
    label: 'Trọn bộ báo cáo',
    periodLabel: '6 tháng',
}

/** Số ngày trial mặc định (khớp trigger grant_trial_on_first_full_shift_close). */
export const TRIAL_DAYS = 7

/**
 * Thông tin nhận chuyển khoản (mở khoá thủ công, giai đoạn chưa có webhook).
 * ⚠️ ĐỔI THÀNH STK THẬT của bạn trước khi public.
 */
export const BANK_INFO = {
    bank: 'MB BANK',
    accountNumber: '0902822192',
    accountName: 'NGUYEN THIEN BANG',
}
