import { useCallback, useContext, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { HistoryContext } from '../../contexts/HistoryContext'
import { useToast } from '../../hooks/useToast'
import { useSavingAction } from '../../hooks/useSavingAction'
import { recordInvoicePayment } from '../../services/orderService'
import { fetchIngredientDebts, type IngredientDebt } from '../../services/expenseService'
import { dateStringVN } from '../../utils/dateVN'
import { formatVND } from '../../utils/money'
import { ingredientLabel } from '../../utils/ingredients'
import InvoicePaymentSheet, { type InvoicePayment } from './InvoicePaymentSheet'
import Toast from '../POSPage/Toast'
import type { Row } from '../../types/domain'

// "Công nợ" của một địa chỉ (phiếu nhập chưa trả đủ) — dùng chung cho sheet "Bổ sung tồn kho" (1 địa chỉ) và dòng địa chỉ mở rộng
// trong "Việc cần làm" (nhiều địa chỉ): cùng danh sách, cùng form trả nợ.

// Công nợ lần tải gần nhất theo địa chỉ: mở lại là có NGAY thay vì hiện sau → khỏi đẩy danh sách xuống. Tải xong thì thay bằng số thật.
const snapshots = new Map<string, IngredientDebt[]>()

export function useIngredientDebts(addressId: string) {
    const [debts, setDebts] = useState<IngredientDebt[]>(() => snapshots.get(addressId) ?? [])
    const reload = useCallback(
        () => fetchIngredientDebts(addressId).then(d => { snapshots.set(addressId, d); setDebts(d) }).catch(err => console.error('fetchIngredientDebts', err)),
        [addressId])
    useEffect(() => { reload() }, [reload])
    return { debts, reload }
}

// Trang chi tiết nguyên liệu (tab Nhật ký, lọc từ ngày phiếu nợ cũ nhất) — cùng URL với openIngredient của trang Tồn kho.
export function ingredientDetailPath(ingredient: string, tab?: 'history', sinceISO?: string) {
    const today = dateStringVN()
    const range = sinceISO && sinceISO < today ? `&scope=custom&start=${sinceISO}&end=${today}` : ''
    return `/inventory/stocking/${encodeURIComponent(ingredient)}${tab ? `?tab=${tab}${range}` : '?scope=month'}`
}

// Form trả nợ + toast. Form là bottom-sheet nên phải vẽ NGOÀI sheet cha (cha có transform → fixed bị lệch): cha tự vẽ `node`
// (và ẩn sheet của mình khi `pay` đang mở). onPaid: cha tải lại công nợ sau khi ghi nhận.
export function useDebtPay(onPaid: () => unknown) {
    const { profile } = useAuth()
    const refreshTodayExpenses = useContext(HistoryContext)?.refreshTodayExpenses // /addresses nằm ngoài POSProvider → không có thì thôi
    const [pay, setPay] = useState<{ addressId: string; invoice: Row } | null>(null)
    const { toast, showToast, showError } = useToast()
    const { saving, withSaving } = useSavingAction(showError)
    const handlePay = ({ amount, paymentMethod, paidAt, cashPhase }: InvoicePayment) => withSaving('Ghi nhận thanh toán', async () => {
        await recordInvoicePayment(pay!.invoice.address_id || pay!.addressId, pay!.invoice.id, amount, paymentMethod, profile?.name, paidAt, cashPhase)
        await Promise.all([onPaid(), refreshTodayExpenses?.()])
        setPay(null)
        showToast('Đã ghi nhận thanh toán', 'success')
    })
    const node = (
        <>
            <Toast toast={toast} />
            {pay && <InvoicePaymentSheet invoice={pay.invoice} saving={saving} onClose={() => setPay(null)} onConfirm={handlePay} />}
        </>
    )
    return { pay, setPay, node, showToast }
}

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
