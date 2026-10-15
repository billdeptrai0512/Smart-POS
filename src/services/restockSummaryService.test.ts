import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('./localRepository', () => ({ isGuest: () => false }))
import { aggregateRestockSummary, groupByIngredient } from './restockSummaryService'

const T = (d: string) => `2026-10-${d}T05:00:00Z`
const FROM = new Date('2026-10-01T00:00:00Z').getTime()
const TO = new Date('2026-10-31T00:00:00Z').getTime()

describe('restock summary', () => {
    const expenses = [
        { address_id: 'A', created_at: T('05'), amount: 1000, metadata: { ingredient: 'cà_phê', qty: 10 }, payments: [{ amount: 400 }] },
        { address_id: 'A', created_at: T('06'), amount: 500, metadata: { ingredient: 'cà_phê', qty: 5 }, payments: [{ amount: 500 }] },
        { address_id: 'A', created_at: T('07'), amount: 0, metadata: { ingredient: 'cà_phê', qty: -2, adjustment: true } },       // hiệu chỉnh: bỏ
        { address_id: 'A', created_at: T('08'), amount: 0, metadata: { ingredient: 'cà_phê', qty: 0, cancelled: true } },        // hủy: bỏ
        { address_id: 'A', created_at: '2026-09-30T05:00:00Z', amount: 999, metadata: { ingredient: 'cà_phê', qty: 99 } },        // ngoài kỳ
    ]
    const closings = [
        { created_at: T('10'), address_id: 'A', inventory_report: [{ ingredient: 'cà_phê', restock: 3 }, { ingredient: 'sữa', restock: 0 }] },
        { created_at: T('11'), address_id: 'B', inventory_report: [{ ingredient: 'cà_phê', restock: 2 }] },
        { created_at: T('12'), address_id: 'A', inventory_report: [{ ingredient: 'cà_phê', restock: 1 }] },
    ]
    const rows = aggregateRestockSummary(expenses, closings, FROM, TO)

    it('gom theo (nguyên liệu, địa chỉ): bỏ hủy/hiệu chỉnh/ngoài kỳ, tính nợ, ẩn nguyên liệu trống', () => {
        expect(rows).toEqual([
            { ingredient: 'cà_phê', address_id: 'A', qty: 15, spent: 1500, owing: 600, withdrawnQty: 4 },
            { ingredient: 'cà_phê', address_id: 'B', qty: 0, spent: 0, owing: 0, withdrawnQty: 2 },
        ])
    })

    it('groupByIngredient: tất cả địa chỉ vs lọc 1 địa chỉ', () => {
        expect(groupByIngredient(rows, null)).toEqual([
            { ingredient: 'cà_phê', qty: 15, spent: 1500, owing: 600, withdrawnQty: 6, withdrawn: { A: 4, B: 2 } },
        ])
        expect(groupByIngredient(rows, 'B')).toEqual([
            { ingredient: 'cà_phê', qty: 0, spent: 0, owing: 0, withdrawnQty: 2, withdrawn: { B: 2 } },
        ])
    })
})
