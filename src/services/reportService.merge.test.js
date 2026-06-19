import { describe, it, expect, vi, beforeEach } from 'vitest'

// The guest path of mergeShiftClosingInventory merges patches into inventory_report
// with the SAME semantics as the server RPC merge_shift_closing_inventory:
//   - upsert by ingredient (editing one NVL never touches another → race-free invariant)
//   - tombstone (all measures null) removes the ingredient
// Tests run the guest branch so no Supabase/Postgres is needed.

const localRepo = {
    isGuest: vi.fn(() => true),
    fetchLocalShiftClosing: vi.fn(() => null),
    upsertLocalShiftClosing: vi.fn((d) => ({ id: 'local', ...d })),
}

vi.mock('../lib/supabaseClient', () => ({ supabase: null }))
vi.mock('./localRepository', () => localRepo)
vi.mock('./cache', () => ({
    reportCache: new Map(), historicalCache: new Map(), invalidateReportCache: vi.fn(),
}))
vi.mock('../utils/dateVN', () => ({
    startOfDayVN: () => new Date(0), endOfDayVN: () => new Date(0), dateStringVN: () => '2026-06-19',
}))

const { mergeShiftClosingInventory } = await import('./reportService')

const entry = (ingredient, remaining) => ({ ingredient, unit: 'g', opening: null, opening_locked: false, remaining, restock: null })

beforeEach(() => { vi.clearAllMocks() })

describe('mergeShiftClosingInventory (merge semantics)', () => {
    it('inserts patches into a fresh report and drops tombstones', async () => {
        localRepo.fetchLocalShiftClosing.mockReturnValue(null)
        const res = await mergeShiftClosingInventory('addr', [
            entry('milk', 500),
            { ingredient: 'sugar', unit: 'g', opening: null, opening_locked: false, remaining: null, restock: null }, // tombstone
        ], 'user', 12345)
        const report = res.inventory_report
        expect(report.map(e => e.ingredient)).toEqual(['milk'])
        expect(res.system_total_revenue).toBe(12345) // seeded on first insert only
    })

    it('editing one ingredient preserves the other (race-free invariant)', async () => {
        localRepo.fetchLocalShiftClosing.mockReturnValue({
            id: 'x', inventory_report: [entry('milk', 500), entry('sugar', 200)],
        })
        const res = await mergeShiftClosingInventory('addr', [entry('milk', 999)], 'user')
        const byIng = Object.fromEntries(res.inventory_report.map(e => [e.ingredient, e.remaining]))
        expect(byIng).toEqual({ milk: 999, sugar: 200 }) // milk updated, sugar untouched
        expect(res.system_total_revenue).toBeUndefined() // not re-seeded on existing row
    })

    it('tombstone removes an existing ingredient, keeps the rest', async () => {
        localRepo.fetchLocalShiftClosing.mockReturnValue({
            id: 'x', inventory_report: [entry('milk', 500), entry('sugar', 200)],
        })
        const res = await mergeShiftClosingInventory('addr', [
            { ingredient: 'sugar', unit: 'g', opening: null, opening_locked: false, remaining: null, restock: null },
        ], 'user')
        expect(res.inventory_report.map(e => e.ingredient)).toEqual(['milk'])
    })
})
