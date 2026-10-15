import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { Row, UUID } from '../types/domain'

// Tổng hợp nhập kho của MỌI nguyên liệu trong 1 khoảng ngày (nhóm kho tổng chung = 1 kho), 1 dòng / (nguyên liệu, địa chỉ):
//   qty/spent/owing — phiếu nhập còn hiệu lực (bỏ hủy + hiệu chỉnh); cùng cách tính với card tổng kết ở Nhật ký.
//   withdrawnQty    — "Rút ra quầy" = Σ inventory_report[].restock của phiếu chốt ca.
// Đường chính: RPC get_restock_summary (cộng ngay trong DB, migration 20261024). Rơi về cộng ở JS khi RPC chưa apply / guest.
export interface RestockSummaryRow {
    ingredient: string
    address_id: UUID
    qty: number
    spent: number
    owing: number
    withdrawnQty: number
}

// Cùng quy tắc với get_restock_summary — sửa 1 nơi phải sửa nơi kia.
export function aggregateRestockSummary(expenses: Row[], closings: Row[], fromMs: number, toMs: number): RestockSummaryRow[] {
    const by = new Map<string, RestockSummaryRow>()
    const row = (ingredient: string, address_id: UUID) => {
        const k = `${ingredient}|${address_id}`
        if (!by.has(k)) by.set(k, { ingredient, address_id, qty: 0, spent: 0, owing: 0, withdrawnQty: 0 })
        return by.get(k)!
    }
    const inRange = (iso: string) => { const t = new Date(iso).getTime(); return t >= fromMs && t <= toMs }

    for (const e of expenses) {
        const ing = e.metadata?.ingredient
        if (!ing || e.metadata?.cancelled || e.metadata?.adjustment || !inRange(e.created_at)) continue
        const r = row(ing, e.address_id)
        const amount = e.amount || 0
        const paid = (e.payments || []).reduce((s: number, p: Row) => s + (p.amount || 0), 0)
        r.qty += Number(e.metadata?.qty) || 0
        r.spent += amount
        r.owing += Math.max(0, amount - paid)
    }
    for (const c of closings) {
        if (!inRange(c.created_at)) continue
        for (const item of Array.isArray(c.inventory_report) ? c.inventory_report : []) {
            const qty = Number(item?.restock) || 0
            if (item?.ingredient && qty > 0) row(item.ingredient, c.address_id).withdrawnQty += qty
        }
    }
    return [...by.values()].filter(r => r.qty || r.spent || r.withdrawnQty)
}

// Gộp theo nguyên liệu; addressId ≠ null → chỉ tính phần của địa chỉ đó (nhập ghi ở địa chỉ nào thì thuộc địa chỉ đó).
export interface IngredientSummary { ingredient: string; qty: number; spent: number; owing: number; withdrawnQty: number; withdrawn: Record<UUID, number> }
export function groupByIngredient(rows: RestockSummaryRow[], addressId: UUID | null): IngredientSummary[] {
    const by: Record<string, IngredientSummary> = {}
    for (const r of rows) {
        if (addressId && r.address_id !== addressId) continue
        const g = by[r.ingredient] ||= { ingredient: r.ingredient, qty: 0, spent: 0, owing: 0, withdrawnQty: 0, withdrawn: {} }
        g.qty += r.qty; g.spent += r.spent; g.owing += r.owing; g.withdrawnQty += r.withdrawnQty
        if (r.withdrawnQty) g.withdrawn[r.address_id] = r.withdrawnQty
    }
    return Object.values(by).sort((a, b) => b.spent - a.spent || b.qty - a.qty || b.withdrawnQty - a.withdrawnQty)
}

// PostgREST cắt 1000 dòng/lần → quét theo trang (cùng cách scanIngredientDebts). Chỉ dùng cho đường dự phòng.
async function fetchAllPages(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
    const PAGE = 1000
    const out: Row[] = []
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1)
        if (error) throw error
        out.push(...(data || []))
        if ((data?.length ?? 0) < PAGE) return out
    }
}

async function fetchSummaryInJs(addressIds: UUID[], fromDate: string, toDate: string) {
    const [expenses, closings] = await Promise.all([
        fetchAllPages((from, to) => supabase
            .from('expenses')
            .select<string, Row>('id, address_id, amount, created_at, metadata, expense_payments(amount)')
            .in('address_id', addressIds).eq('is_refill', true)
            .gte('created_at', fromDate).lte('created_at', toDate)
            .order('created_at').order('id').range(from, to)),
        fetchAllPages((from, to) => supabase
            .from('shift_closings')
            .select<string, Row>('id, address_id, created_at, inventory_report')
            .in('address_id', addressIds)
            .gte('created_at', fromDate).lte('created_at', toDate)
            .order('created_at').order('id').range(from, to)),
    ])
    return aggregateRestockSummary(expenses.map(e => ({ ...e, payments: e.expense_payments })), closings, new Date(fromDate).getTime(), new Date(toDate).getTime())
}

export async function fetchRestockSummary(addressIds: UUID[], fromDate: string, toDate: string): Promise<RestockSummaryRow[]> {
    if (localRepo.isGuest()) {
        const id = addressIds[0] // guest không có nhóm kho tổng
        const payments = localRepo.fetchAllLocalExpensePayments(id)
        const expenses = localRepo.fetchAllLocalExpenses(id).filter((e: Row) => e.is_refill)
            .map((e: Row) => ({ ...e, payments: payments.filter((p: Row) => p.expense_id === e.id) }))
        return aggregateRestockSummary(expenses, localRepo.fetchAllLocalShiftClosings(id), new Date(fromDate).getTime(), new Date(toDate).getTime())
    }
    if (!addressIds.length) return []
    const { data, error } = await supabase.rpc('get_restock_summary', { p_address_ids: addressIds, p_from: fromDate, p_to: toDate })
    if (!error) {
        return ((data || []) as Row[]).map(r => ({
            ingredient: r.ingredient, address_id: r.address_id,
            qty: Number(r.qty), spent: Number(r.spent), owing: Number(r.owing), withdrawnQty: Number(r.withdrawn_qty),
        }))
    }
    // 42883 / PGRST202 = hàm chưa có (migration chưa apply) → cộng ở JS. Lỗi khác (vd quyền) thì báo thật.
    if (error.code !== '42883' && error.code !== 'PGRST202') throw error
    return fetchSummaryInJs(addressIds, fromDate, toDate)
}
