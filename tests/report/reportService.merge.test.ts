// Báo cáo — mergeShiftClosingInventory: ngữ nghĩa gộp tồn khi nhiều lần chốt ca.
// Nguồn: src/services/reportService.js

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
    fetchAllLocalExpenses: vi.fn(() => []),
    updateLocalExpense: vi.fn(),
}

vi.mock('../../src/lib/supabaseClient', () => ({ supabase: null }))
vi.mock('../../src/services/localRepository', () => localRepo)
vi.mock('../../src/services/cache', () => ({
    reportCache: new Map(), historicalCache: new Map(), invalidateReportCache: vi.fn(),
}))
vi.mock('../../src/utils/dateVN', () => ({
    startOfDayVN: () => new Date(0), endOfDayVN: () => new Date(0), dateStringVN: () => '2026-06-19',
}))

const { mergeShiftClosingInventory, stripInsertOnlyDefaults } = await import('../../src/services/reportService')

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

    // Bug 02/07: rút ra quầy nhập MUỘN (sau khi đã nhập kho trong ngày) → snapshot
    // before/after_stock của phiếu nhập tạo sau phiếu chốt ca phải bị trừ delta rút,
    // nếu không neo after_stock giữ kho chưa trừ rút → tồn thổi phồng vĩnh viễn.
    it('restock delta cascades into refill snapshots created after the shift row', async () => {
        localRepo.fetchLocalShiftClosing.mockReturnValue({
            id: 'x', created_at: '2026-07-01T02:23:00Z', // 09:23 VN
            inventory_report: [{ ingredient: 'milk', unit: 'g', opening: 1026, remaining: null, restock: null }],
        })
        localRepo.fetchAllLocalExpenses.mockReturnValue([
            { // phiếu nhập 12:00 — TẠO SAU phiếu chốt ca → phải cascade −1026
                id: 'r1', is_refill: true, created_at: '2026-07-01T05:00:00Z',
                metadata: { ingredient: 'milk', qty: 10260, before_stock: 1026, after_stock: 11286 },
            },
            { // phiếu tạo TRƯỚC phiếu chốt ca → giữ nguyên
                id: 'r0', is_refill: true, created_at: '2026-06-30T05:00:00Z',
                metadata: { ingredient: 'milk', qty: 1026, before_stock: 0, after_stock: 1026 },
            },
        ])
        await mergeShiftClosingInventory('addr', [
            { ingredient: 'milk', unit: 'g', opening: 1026, opening_locked: false, remaining: null, restock: 1026 },
        ], 'user')
        expect(localRepo.updateLocalExpense).toHaveBeenCalledTimes(1)
        expect(localRepo.updateLocalExpense).toHaveBeenCalledWith('r1', {
            metadata: expect.objectContaining({ before_stock: 0, after_stock: 10260 }),
        })
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

describe('stripInsertOnlyDefaults (self-heal không xoá kiểm kê)', () => {
    it('bỏ inventory_report=[] và note="" để update không đè dữ liệu đã có', () => {
        const out = stripInsertOnlyDefaults({
            address_id: 'a', actual_cash: 500, inventory_report: [], note: '', cash_closed_at: 't',
        })
        expect(out).not.toHaveProperty('inventory_report') // ← giữ nguyên kiểm kê máy B
        expect(out).not.toHaveProperty('note')
        expect(out).toMatchObject({ address_id: 'a', actual_cash: 500, cash_closed_at: 't' })
    })

    it('giữ inventory_report khi có dữ liệu thật (không phải default insert)', () => {
        const out = stripInsertOnlyDefaults({ inventory_report: [entry('milk', 1)], note: 'x' })
        expect(out.inventory_report).toHaveLength(1)
        expect(out.note).toBe('x')
    })
})
