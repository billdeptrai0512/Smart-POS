import type { CartItem, Discount, DiscountResult } from '../types/domain'

export const NO_DISCOUNT: Discount = { type: 'percent', value: 0 }

// Format VND currency
export function formatVND(amount: number): string {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

// Format a raw number string with Vietnamese thousand separators for input display
// e.g. "1000000" → "1.000.000"
export function formatVNDInput(value: string | number): string {
    if (!value && value !== 0) return ''
    const numStr = String(value).replace(/[^\d]/g, '')
    if (!numStr) return ''
    return new Intl.NumberFormat('vi-VN').format(Number(numStr))
}

// Parse a formatted VND input string back to a number
// e.g. "1.000.000" → 1000000
export function parseVNDInput(formatted: string | number): number {
    if (!formatted) return 0
    const numStr = String(formatted).replace(/[^\d]/g, '')
    return Number(numStr) || 0
}

// Resolve a per-order discount ({ type: 'percent' | 'amount', value }) against a
// subtotal. Clamps % to 100 and amount to the subtotal so finalTotal never goes
// negative. Single source of truth shared by POSContext and the discount modal.
export function computeDiscount(subtotal: number, discount: Discount): DiscountResult {
    const discountAmount = !discount.value
        ? 0
        : discount.type === 'percent'
            ? Math.round(subtotal * Math.min(discount.value, 100) / 100)
            : Math.min(discount.value, subtotal)
    return { discountAmount, finalTotal: Math.max(0, subtotal - discountAmount) }
}

// Gross subtotal of one cart line (product + extras) × quantity, before that
// line's own discount. Shared by POSContext (order totals) and the cart list's
// per-item discount modal (its subtotal).
export function cartLineSubtotal(item: CartItem): number {
    const extrasPrice = (item.extras || []).reduce((sum, e) => sum + e.price, 0)
    return (item.basePrice + extrasPrice) * item.quantity
}

// Suy % từ số đ đã giảm — orders chỉ lưu discount_amount, không lưu %/đ đã CHỌN lúc áp
// (xem computeDiscount ở trên). Dùng cho nhãn hiển thị (nút "-15%", bill in) lẫn seed lại
// DiscountModal khi sửa. exact=true chỉ khi % suy ra tính NGƯỢC LẠI đúng y hệt amount gốc
// (không lệch làm tròn) — false thì bên gọi nên giữ nguyên dạng "đ" khi seed lại modal,
// tránh bấm "Đồng ý" mà không sửa gì lại âm thầm đổi số tiền giảm đi vài đồng.
export function discountToPercent(subtotal: number, amount: number): { pct: number; exact: boolean } {
    if (subtotal <= 0 || amount <= 0) return { pct: 0, exact: false }
    const pct = Math.round((amount / subtotal) * 100)
    return { pct, exact: Math.round(subtotal * pct / 100) === amount }
}
