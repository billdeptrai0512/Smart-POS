import { describe, it, expect } from 'vitest'
import { buildCategoryBreakdown } from './expenseCategoryBreakdown'

const cats = [
    { id: 'op-salary', name: 'Lương nhân viên', group_section: 'operating', sort_order: 10, is_default: true },
    { id: 'op-rent',   name: 'Thuê mặt bằng',   group_section: 'operating', sort_order: 20, is_default: true },
    { id: 'op-other',  name: 'Chi phí khác',    group_section: 'operating', sort_order: 999, is_default: true },
    { id: 'oh-mgr',    name: 'Lương quản lý',   group_section: 'overhead',  sort_order: 10, is_default: true },
    { id: 'oh-other',  name: 'Chi phí khác',    group_section: 'overhead',  sort_order: 999, is_default: true },
    { id: 'op-custom', name: 'Marketing FB',    group_section: 'operating', sort_order: 50, is_default: false },
    { id: 'inv-mat',   name: 'Mua nguyên liệu', group_section: 'inventory', sort_order: 10, is_default: true },
    { id: 'nop-draw',  name: 'Rút vốn',         group_section: 'non_operating', sort_order: 10, is_default: true },
]

describe('buildCategoryBreakdown', () => {
    it('buckets expenses into operating + overhead by category', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: 'op-salary' },
            { id: '2', amount: 200, category_id: 'op-rent' },
            { id: '3', amount: 500, category_id: 'oh-mgr' },
        ]
        const { operatingTotal, overheadTotal } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingTotal).toBe(300)
        expect(overheadTotal).toBe(500)
    })

    it('tách inventory thành nhóm riêng, loại non_operating khỏi mọi tổng', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: 'op-salary' },
            { id: '2', amount: 300, category_id: 'inv-mat' },
            { id: '3', amount: 999, category_id: 'nop-draw' },
        ]
        const r = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(r.operatingTotal).toBe(100)
        expect(r.inventoryTotal).toBe(300)
        expect(r.inventoryRows).toHaveLength(1)
        expect(r.inventoryRows[0].id).toBe('inv-mat')
        // non_operating không lọt vào bất kỳ tổng/row nào.
        expect(r.overheadTotal).toBe(0)
        const allIds = [...r.operatingRows, ...r.overheadRows, ...r.inventoryRows].map(x => x.id)
        expect(allIds).not.toContain('nop-draw')
    })

    it('skips NVL refill rows (is_refill without free_form)', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: 'op-salary' },
            { id: '2', amount: 5000, is_refill: true, metadata: { ingredient: 'coffee_g', qty: 100 } },
        ]
        const { operatingTotal } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingTotal).toBe(100)
    })

    it('includes free-form refill (sau ca operational expense)', () => {
        const expenses = [
            { id: '1', amount: 50, is_refill: true, metadata: { free_form: true }, category_id: 'op-other' },
        ]
        const { operatingTotal } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingTotal).toBe(50)
    })

    it('skips adjustment rows', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: 'op-salary' },
            // amount=0 already wouldn't move totals, but adjustment with any value should skip
            { id: '2', amount: 999, is_refill: true, metadata: { ingredient: 'coffee_g', qty: 5, adjustment: true } },
        ]
        const { operatingTotal } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingTotal).toBe(100)
    })

    it('falls back null/orphan category to operating "Chi phí khác"', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: null },               // never tagged
            { id: '2', amount: 200, category_id: 'deleted-tag-uuid' }, // orphan
            { id: '3', amount: 50,  category_id: 'op-salary' },
        ]
        const { operatingRows, operatingTotal } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingTotal).toBe(350)
        const otherRow = operatingRows.find(r => r.id === 'op-other')
        expect(otherRow.amount).toBe(300)
    })

    it('hiện MỌI nhãn active operating (default + manager tự tạo) kể cả amount=0', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: 'op-salary' },
        ]
        const { operatingRows } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        // op-custom (Marketing FB) is_default=false + amount=0 → vẫn hiện (phản ánh setup).
        expect(operatingRows.find(r => r.id === 'op-custom')).toEqual(
            expect.objectContaining({ id: 'op-custom', amount: 0 })
        )
        // op-rent is_default=true + amount=0 → vẫn hiện.
        expect(operatingRows.find(r => r.id === 'op-rent')).toEqual(
            expect.objectContaining({ id: 'op-rent', amount: 0 })
        )
    })

    it('shows manager-created category when it has spending', () => {
        const expenses = [
            { id: '1', amount: 300, category_id: 'op-custom' },
        ]
        const { operatingRows } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingRows.find(r => r.id === 'op-custom')).toEqual(
            expect.objectContaining({ id: 'op-custom', amount: 300 })
        )
    })

    it('sorts rows by sort_order asc', () => {
        const expenses = [
            { id: '1', amount: 10, category_id: 'op-custom' },
            { id: '2', amount: 10, category_id: 'op-salary' },
            { id: '3', amount: 10, category_id: 'op-rent' },
        ]
        const { operatingRows } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        const ids = operatingRows.map(r => r.id)
        // sort_order: salary=10, rent=20, custom=50, other=999
        expect(ids[0]).toBe('op-salary')
        expect(ids[1]).toBe('op-rent')
        expect(ids[2]).toBe('op-custom')
    })

    it('handles empty inputs gracefully', () => {
        expect(buildCategoryBreakdown({ expenses: [], expenseCategories: [] })).toEqual({
            operatingRows: [],
            overheadRows: [],
            inventoryRows: [],
            operatingTotal: 0,
            overheadTotal: 0,
            inventoryTotal: 0,
        })
    })

    it('gắn entries từng khoản vào row (gồm orphan rớt về "Chi phí khác")', () => {
        const expenses = [
            { id: 'a', name: 'Sửa wifi', amount: 30, category_id: 'op-other', created_at: '2026-06-01' },
            { id: 'b', name: 'Linh tinh', amount: 10, category_id: null },          // orphan → op-other
            { id: 'c', name: 'Lương', amount: 50, category_id: 'op-salary' },
        ]
        const { operatingRows } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        const other = operatingRows.find(r => r.id === 'op-other')
        expect(other.amount).toBe(40)
        expect(other.entries.map(e => e.id).sort()).toEqual(['a', 'b'])
        expect(other.entries.reduce((s, e) => s + e.amount, 0)).toBe(other.amount)
        // nhãn rỗng → entries rỗng (không undefined)
        expect(operatingRows.find(r => r.id === 'op-rent').entries).toEqual([])
    })

    it('counts legacy is_fixed=true expenses (auto-injected from old templates)', () => {
        const expenses = [
            { id: '1', amount: 100, category_id: 'op-rent', is_fixed: true },
            { id: '2', amount: 50, category_id: 'op-salary' },
        ]
        const { operatingTotal } = buildCategoryBreakdown({ expenses, expenseCategories: cats })
        expect(operatingTotal).toBe(150)
    })
})
