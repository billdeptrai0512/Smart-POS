import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { Row, UUID } from '../types/domain'

// Tổng hợp nhập kho của MỌI nguyên liệu trong 1 khoảng ngày (nhóm kho tổng chung = 1 kho):
//   qty/spent/owing — phiếu nhập còn hiệu lực (bỏ hủy + hiệu chỉnh); cùng cách tính với card tổng kết ở Nhật ký.
//   withdrawn       — "Rút ra quầy" = Σ inventory_report[].restock của phiếu chốt ca, tách theo địa chỉ.
export interface RestockSummaryRow {
    ingredient: string
    qty: number
    spent: number
    owing: number
    withdrawnQty: number
    withdrawn: Record<UUID, number>
}

export function aggregateRestockSummary(expenses: Row[], closings: Row[], fromMs: number, toMs: number): RestockSummaryRow[] {
    const by: Record<string, RestockSummaryRow> = {}
    const row = (ingredient: string) => by[ingredient] ||= { ingredient, qty: 0, spent: 0, owing: 0, withdrawnQty: 0, withdrawn: {} }
    const inRange = (iso: string) => { const t = new Date(iso).getTime(); return t >= fromMs && t <= toMs }

    for (const e of expenses) {
        const ing = e.metadata?.ingredient
        if (!ing || e.metadata?.cancelled || e.metadata?.adjustment || !inRange(e.created_at)) continue
        const r = row(ing)
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
            if (!item?.ingredient || qty <= 0) continue
            const r = row(item.ingredient)
            r.withdrawnQty += qty
            r.withdrawn[c.address_id] = (r.withdrawn[c.address_id] || 0) + qty
        }
    }
    return Object.values(by)
        .filter(r => r.qty || r.spent || r.withdrawnQty)
        .sort((a, b) => b.spent - a.spent || b.qty - a.qty)
}

// PostgREST cắt 1000 dòng/lần → quét theo trang (cùng cách scanIngredientDebts).
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

export async function fetchRestockSummary(addressIds: UUID[], fromDate: string, toDate: string): Promise<RestockSummaryRow[]> {
    const fromMs = new Date(fromDate).getTime(), toMs = new Date(toDate).getTime()
    if (localRepo.isGuest()) {
        const id = addressIds[0] // guest không có nhóm kho tổng
        const payments = localRepo.fetchAllLocalExpensePayments(id)
        const expenses = localRepo.fetchAllLocalExpenses(id).filter((e: Row) => e.is_refill)
            .map((e: Row) => ({ ...e, payments: payments.filter((p: Row) => p.expense_id === e.id) }))
        return aggregateRestockSummary(expenses, localRepo.fetchAllLocalShiftClosings(id), fromMs, toMs)
    }
    if (!addressIds.length) return []
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
    return aggregateRestockSummary(expenses.map(e => ({ ...e, payments: e.expense_payments })), closings, fromMs, toMs)
}
