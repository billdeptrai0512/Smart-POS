import { dateStringVN, timeStringVN } from './dateVN'
import type { RestockInitial } from '../components/IngredientManagementPage/RestockModal'
import type { Row } from '../types/domain'

/** Giá trị khởi tạo form sửa phiếu nhập kho (RestockModal mode="edit") từ một dòng expense đã fetch. */
export function restockInitialFrom(entry: Row): RestockInitial {
    return {
        qty: entry.metadata?.qty ?? 0,
        subtotal: entry.metadata?.subtotal ?? entry.amount ?? 0,
        discount: entry.discount_amount ?? 0,
        extraCost: entry.extra_cost ?? 0,
        paid: (entry.payments || []).reduce((s: number, p: Row) => s + (p.amount || 0), 0),
        paymentMethod: entry.payment_method || 'cash',
        cashPhase: entry.metadata?.cash_phase || 'post_close',
        purchaseDate: dateStringVN(new Date(entry.created_at)),
        purchaseTime: timeStringVN(new Date(entry.created_at)),
    }
}
