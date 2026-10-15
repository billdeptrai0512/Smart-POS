import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('./localRepository', () => ({ isGuest: () => false }))
import { aggregateRestockSummary } from './restockSummaryService'

const T = (d: string) => `2026-10-${d}T05:00:00Z`
const FROM = new Date('2026-10-01T00:00:00Z').getTime()
const TO = new Date('2026-10-31T00:00:00Z').getTime()

describe('aggregateRestockSummary', () => {
    const expenses = [
        { created_at: T('05'), amount: 1000, metadata: { ingredient: 'cà_phê', qty: 10 }, payments: [{ amount: 400 }] },
        { created_at: T('06'), amount: 500, metadata: { ingredient: 'cà_phê', qty: 5 }, payments: [{ amount: 500 }] },
        { created_at: T('07'), amount: 0, metadata: { ingredient: 'cà_phê', qty: -2, adjustment: true } },       // hiệu chỉnh: bỏ
        { created_at: T('08'), amount: 0, metadata: { ingredient: 'cà_phê', qty: 0, cancelled: true } },        // hủy: bỏ
        { created_at: '2026-09-30T05:00:00Z', amount: 999, metadata: { ingredient: 'cà_phê', qty: 99 } },        // ngoài kỳ
    ]
    const closings = [
        { created_at: T('10'), address_id: 'A', inventory_report: [{ ingredient: 'cà_phê', restock: 3 }, { ingredient: 'sữa', restock: 0 }] },
        { created_at: T('11'), address_id: 'B', inventory_report: [{ ingredient: 'cà_phê', restock: 2 }] },
        { created_at: T('12'), address_id: 'A', inventory_report: [{ ingredient: 'cà_phê', restock: 1 }] },
    ]

    it('gom phiếu nhập còn hiệu lực, nợ, và rút ra quầy theo từng địa chỉ', () => {
        const [r, ...rest] = aggregateRestockSummary(expenses, closings, FROM, TO)
        expect(rest).toEqual([])   // "sữa" không có gì trong kỳ → ẩn
        expect(r).toEqual({ ingredient: 'cà_phê', qty: 15, spent: 1500, owing: 600, withdrawnQty: 6, withdrawn: { A: 4, B: 2 } })
    })
})
