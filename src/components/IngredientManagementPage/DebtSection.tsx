import { ChevronRight } from 'lucide-react'
import type { IngredientDebt } from '../../services/expenseService'
import { dateStringVN } from '../../utils/dateVN'
import { formatVND } from '../../utils/money'
import { ingredientLabel } from '../../utils/ingredients'
import type { Row } from '../../types/domain'

// "Công nợ" của một địa chỉ (phiếu nhập chưa trả đủ) — dùng chung cho sheet "Bổ sung tồn kho" (1 địa chỉ) và dòng địa chỉ mở rộng
// trong "Việc cần làm" (nhiều địa chỉ): cùng danh sách, cùng form trả nợ.

// Nợ chỉ 1 phiếu → mở thẳng form trả nợ; nhiều phiếu thì vào Nhật ký của nguyên liệu để chọn phiếu cần trả.
export function DebtList({ debts, onPay, onOpenIngredient }: { debts: IngredientDebt[]; onPay: (invoice: Row) => void; onOpenIngredient?: (ingredient: string, tab: 'history', sinceISO: string) => void }) {
    return debts.map(d => (
        <button
            key={d.ingredient}
            type="button"
            onClick={d.invoices.length === 1 ? () => onPay(d.invoices[0]) : onOpenIngredient && (() => onOpenIngredient(d.ingredient, 'history', dateStringVN(new Date(d.invoices[0].created_at))))}
            className="w-full flex items-center gap-3 py-2.5 border-b border-border/20 last:border-b-0 text-left active:scale-[0.99] transition"
        >
            <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-bold leading-tight text-text">{ingredientLabel(d.ingredient)}</span>
                <span className="block mt-0.5 text-[11px] text-text-dim">{d.invoices.length} phiếu chưa trả đủ</span>
            </span>
            <span className="shrink-0 text-[15px] font-black text-warning tabular-nums">{formatVND(d.owing)}</span>
            <ChevronRight size={15} className="shrink-0 text-text-dim -ml-1" />
        </button>
    ))
}
