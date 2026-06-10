// ─── Monetization — 1 gói all-access duy nhất ────────────────────────────────
// Single source of truth cho UI checkout. Khớp docs/MONETIZATION.md §1.
//
// 1 gói duy nhất mở khoá CẢ 3 view báo cáo (Dòng tiền + Lợi nhuận + Tồn kho).
// Giá trị `tier` trong DB cho gói này = 'all'.

import { Wallet, TrendingUp, Package } from 'lucide-react'

/** Giá trị tier lưu trong address_subscriptions cho gói all-access. */
export const ALL_TIER = 'all'

/** Gói duy nhất: 888,888đ / 6 tháng / 1 địa chỉ. */
export const PLAN = {
    months: 6,
    price: 888888,
    label: 'Trọn bộ báo cáo',
    periodLabel: '6 tháng',
}

/** Số ngày trial mặc định (khớp trigger grant_trial_on_address_creation). */
export const TRIAL_DAYS = 7

/** Các view được mở khoá — hiển thị "gồm gì" trong checkout. */
export const PLAN_FEATURES = [
    { icon: Wallet, label: 'Dòng tiền', desc: 'Thu chi, chuyển khoản, số ly bán' },
    { icon: TrendingUp, label: 'Lợi nhuận', desc: 'Lãi lỗ, doanh thu, giá vốn (COGS)' },
    { icon: Package, label: 'Tồn kho', desc: 'Nhập/tồn, hao hụt, gợi ý đi chợ' },
]

/**
 * Thông tin nhận chuyển khoản (mở khoá thủ công, giai đoạn chưa có webhook).
 * ⚠️ ĐỔI THÀNH STK THẬT của bạn trước khi public.
 */
export const BANK_INFO = {
    bank: 'MB BANK',
    accountNumber: '0902822192',
    accountName: 'NGUYEN THIEN BANG',
}
