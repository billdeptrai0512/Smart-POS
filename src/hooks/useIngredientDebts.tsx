import { useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { HistoryContext } from '../contexts/HistoryContext'
import { useToast } from './useToast'
import { useSavingAction } from './useSavingAction'
import { recordInvoicePayment } from '../services/orderService'
import { fetchIngredientDebts, type IngredientDebt } from '../services/expenseService'
import { dateStringVN } from '../utils/dateVN'
import InvoicePaymentSheet, { type InvoicePayment } from '../components/IngredientManagementPage/InvoicePaymentSheet'
import Toast from '../components/POSPage/Toast'
import type { Row } from '../types/domain'

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
