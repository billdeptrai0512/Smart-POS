import type { Discount, DiscountResult } from '../types/domain'

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
