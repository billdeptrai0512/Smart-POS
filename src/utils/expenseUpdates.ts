import { dateStringVN } from './dateVN'
import type { Row } from '../types/domain'

interface ExpenseForm {
    name: string
    amount: number
    paymentMethod: string
    categoryId: string | null
    /** YYYY-MM-DD (giờ VN) */
    date: string
    /** "Sau chốt ca": lưu is_refill=true + metadata.free_form; "Trong ca" thì không. */
    isAfterShift: boolean
}

/** Các trường cần UPDATE khi sửa một chi phí. Chỉ đổi created_at khi NGÀY khác ngày gốc (cùng ngày thì giữ giờ gốc). */
export function buildExpenseUpdates(expense: Row, f: ExpenseForm) {
    const sameDay = dateStringVN(new Date(expense.created_at)) === f.date
    return {
        name: f.name.trim(),
        amount: f.amount,
        payment_method: f.paymentMethod,
        category_id: f.categoryId || null,
        created_at: sameDay ? expense.created_at : new Date(`${f.date}T12:00:00+07:00`).toISOString(),
        is_refill: f.isAfterShift,
        metadata: f.isAfterShift ? { free_form: true } : {},
    }
}
