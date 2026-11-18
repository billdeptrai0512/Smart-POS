import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN, addDaysVN } from '../utils/dateVN'
import { computeCashFlowTotals } from '../utils/reportStats'
import { fetchAllPages } from './fetchAllPages'
import type { Row, UUID } from '../types/domain'

export interface BranchActualTotals { today: Record<string, number>; prev: Record<string, number> }
export interface RangeTotals { cups: number; revenue: number; prevCups: number; prevRevenue: number; actual: number | null; prevActual: number }

// Thực thu từng (chi nhánh, ngày) kể từ `since` — cùng công thức thẻ Thực thu trang Báo cáo (computeCashFlowTotals):
// tiền mặt + CK đã nhập + chi trong ca. Mỗi chi nhánh mỗi ngày lấy phiếu kết ca MỚI NHẤT đã nhập tiền
// (shift_closings.cash_closed_at != null; giống get_daily_report_context: ORDER BY closed_at DESC LIMIT 1).
// `dayOf` đổi mốc thời gian → số ngày. Chi nhánh/ngày chưa nhập tiền thì không có dòng.
async function fetchDailyActuals(addressIds: UUID[], since: string, dayOf: (iso: string) => number) {
    const key = (r: Row, at: string) => `${r.address_id}|${dayOf(r[at])}`
    // Cả 3 truy vấn chạy song song (không đợi phiếu kết ca để lọc chi nhánh): bớt 1 lượt chờ, đổi lại tải dư
    // chi phí của chi nhánh chưa nhập tiền — các dòng đó bị bỏ ở bước ghép bên dưới.
    const [closings, payments, expenses] = await Promise.all([
        fetchAllPages((from, to) => supabase
            .from('shift_closings').select('address_id, actual_cash, actual_transfer, closed_at')
            .in('address_id', addressIds).gte('closed_at', since).not('cash_closed_at', 'is', null)
            .order('closed_at', { ascending: false }).order('id').range(from, to)),
        fetchAllPages((from, to) => supabase
            .from('expense_payments')
            .select('address_id, amount, payment_method, cash_phase, expense_id, paid_at, invoice:expenses(metadata)')
            .in('address_id', addressIds).gte('paid_at', since)
            .order('paid_at').order('id').range(from, to)),
        fetchAllPages((from, to) => supabase
            .from('expenses').select('id, address_id, amount, metadata, created_at')
            .in('address_id', addressIds).eq('is_refill', false).gte('created_at', since)
            .order('created_at').order('id').range(from, to)),
    ])
    const latest = new Map<string, Row>() // đã order closed_at DESC → phiếu đầu tiên mỗi khoá là mới nhất
    for (const c of closings) if (!latest.has(key(c, 'closed_at'))) latest.set(key(c, 'closed_at'), c)
    const group = (rows: Row[], at: string) => {
        const m = new Map<string, Row[]>()
        for (const r of rows) {
            const k = key(r, at)
            ;(m.get(k) ?? m.set(k, []).get(k)!).push(r)
        }
        return m
    }
    const payBy = group(payments.map(p => ({ ...p, invoice_metadata: p.invoice?.metadata })), 'paid_at')
    const expBy = group(expenses, 'created_at')

    return [...latest].map(([k, c]) => ({
        addressId: c.address_id as string,
        day: dayOf(c.closed_at),
        value: computeCashFlowTotals({
            liveCash: Number(c.actual_cash) || 0,
            liveTransfer: Number(c.actual_transfer) || 0,
            payments: payBy.get(k),
            shiftExpenses: expBy.get(k),
        }).actualTotal,
    }))
}

// Thực thu HÔM NAY và HÔM QUA của nhiều chi nhánh. Hôm qua là CẢ ngày (Thực thu chỉ nhập 1 lần lúc kết ca
// nên không có "cùng giờ" như doanh thu).
export async function fetchBranchesTodayActualTotals(addressIds: UUID[]): Promise<BranchActualTotals> {
    const out: BranchActualTotals = { today: {}, prev: {} }
    if (localRepo.isGuest() || !addressIds.length) return out
    const todayStart = startOfDayVN()
    const rows = await fetchDailyActuals(addressIds, addDaysVN(todayStart, -1).toISOString(), iso => (new Date(iso) >= todayStart ? 1 : 0))
    for (const r of rows) out[r.day ? 'today' : 'prev'][r.addressId] = r.value
    return out
}

// Thẻ tổng header khi lọc `days` ngày gần nhất (gồm hôm nay) so với `days` ngày liền trước.
// Ly/doanh thu: RPC get_range_stats_totals. Thực thu: cộng theo ngày, actual=null nếu kỳ hiện tại chưa nhập ngày nào.
export async function fetchRangeTotals(addressIds: UUID[], days: number): Promise<RangeTotals | null> {
    if (localRepo.isGuest() || !addressIds.length) return null
    const base = addDaysVN(startOfDayVN(), -(2 * days - 1)) // đầu kỳ liền trước
    const [stats, rows] = await Promise.all([
        supabase.rpc('get_range_stats_totals', { p_address_ids: addressIds, p_days: days }),
        fetchDailyActuals(addressIds, base.toISOString(), iso => Math.floor((new Date(iso).getTime() - base.getTime()) / 86_400_000)),
    ])
    if (stats.error) throw stats.error
    const s = stats.data?.[0]
    if (!s) return null
    const cur = rows.filter(r => r.day >= days)
    const sum = (rs: typeof rows) => rs.reduce((t, r) => t + r.value, 0)
    return {
        cups: Number(s.cups), revenue: Number(s.revenue), prevCups: Number(s.prev_cups), prevRevenue: Number(s.prev_revenue),
        actual: cur.length ? sum(cur) : null, prevActual: sum(rows.filter(r => r.day < days)),
    }
}
