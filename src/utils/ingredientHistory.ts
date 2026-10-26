import type { Row } from '../types/domain'

export type HistoryKind = 'restock' | 'adjustment' | 'withdrawal' | 'production' | 'cancelled'

// Đã hủy ưu tiên trước loại gốc (phiếu hủy bị zero trong DB nhưng vẫn mang cờ adjustment/restock).
export const kindOf = (e: Row): HistoryKind =>
    e.metadata?.cancelled ? 'cancelled' : e.is_withdrawal ? 'withdrawal' : e.is_production ? 'production' : e.metadata?.adjustment ? 'adjustment' : 'restock'

export type DebtStatus = 'owing' | 'paid'

// Chỉ phiếu nhập còn hiệu lực mới có công nợ; các loại thẻ khác → null (bị loại khi lọc theo công nợ).
export const debtOf = (e: Row): DebtStatus | null => {
    if (kindOf(e) !== 'restock') return null
    const paid = (e.payments || []).reduce((s: number, p: Row) => s + (p.amount || 0), 0)
    return (e.amount || 0) - paid > 0 ? 'owing' : 'paid'
}
