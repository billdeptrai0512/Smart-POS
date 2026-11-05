import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN, addDaysVN } from '../utils/dateVN'
import { computeCashFlowTotals } from '../utils/reportStats'
import { fetchAllPages } from './fetchAllPages'
import type { Row, UUID } from '../types/domain'

export interface BranchActualTotals { today: Record<string, number>; prev: Record<string, number> }

// Tổng thực thu HÔM NAY và HÔM QUA của nhiều chi nhánh — cùng công thức với thẻ Thực thu trang
// Báo cáo (computeCashFlowTotals): tiền mặt + CK đã nhập + chi trong ca. Chỉ có key ở ngày nào
// chi nhánh ĐÃ nhập tiền (shift_closings.cash_closed_at != null). Hôm qua là CẢ ngày (Thực thu
// chỉ nhập 1 lần lúc kết ca nên không có "cùng giờ" như doanh thu).
// ponytail: 3 query gộp theo address_id thay vì RPC mới (không cần migration); nếu thẻ chi nhánh cần
// thêm Thực chi/Thực nhận thì gộp vào get_branches_today_stats.
export async function fetchBranchesTodayActualTotals(addressIds: UUID[]): Promise<BranchActualTotals> {
    const out: BranchActualTotals = { today: {}, prev: {} }
    if (localRepo.isGuest() || !addressIds.length) return out
    const todayStart = startOfDayVN()
    const prevStart = addDaysVN(todayStart, -1)
    const since = prevStart.toISOString()
    const isToday = (iso: string) => new Date(iso) >= todayStart

    const { data: closings, error } = await supabase
        .from('shift_closings')
        .select('address_id, actual_cash, actual_transfer, closed_at')
        .in('address_id', addressIds)
        .gte('closed_at', since)
        .not('cash_closed_at', 'is', null)
        .order('closed_at', { ascending: false })
    if (error) throw error
    // Phiếu mới nhất mỗi chi nhánh mỗi ngày (giống get_daily_report_context: ORDER BY closed_at DESC LIMIT 1)
    const latest = new Map<string, Row>()
    for (const c of closings || []) {
        const key = `${c.address_id}|${isToday(c.closed_at) ? 'today' : 'prev'}`
        if (!latest.has(key)) latest.set(key, c)
    }
    if (!latest.size) return out
    const entered = [...new Set([...latest.values()].map(c => c.address_id))]

    const [payments, expenses] = await Promise.all([
        fetchAllPages((from, to) => supabase
            .from('expense_payments')
            .select('address_id, amount, payment_method, cash_phase, expense_id, paid_at, invoice:expenses(metadata)')
            .in('address_id', entered).gte('paid_at', since)
            .order('paid_at').order('id').range(from, to)),
        fetchAllPages((from, to) => supabase
            .from('expenses')
            .select('id, address_id, amount, metadata, created_at')
            .in('address_id', entered).eq('is_refill', false).gte('created_at', since)
            .order('created_at').order('id').range(from, to)),
    ])

    const group = (rows: Row[], at: string) => {
        const m = new Map<string, Row[]>()
        for (const r of rows) {
            const k = `${r.address_id}|${isToday(r[at]) ? 'today' : 'prev'}`
            ;(m.get(k) ?? m.set(k, []).get(k)!).push(r)
        }
        return m
    }
    const payBy = group(payments.map(p => ({ ...p, invoice_metadata: p.invoice?.metadata })), 'paid_at')
    const expBy = group(expenses, 'created_at')

    for (const [key, c] of latest) {
        const day = key.endsWith('|today') ? 'today' : 'prev'
        out[day][c.address_id] = computeCashFlowTotals({
            liveCash: Number(c.actual_cash) || 0,
            liveTransfer: Number(c.actual_transfer) || 0,
            payments: payBy.get(key),
            shiftExpenses: expBy.get(key),
        }).actualTotal
    }
    return out
}
