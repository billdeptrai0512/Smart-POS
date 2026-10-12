import { describe, it, expect } from 'vitest'
import { missingUsageDays, usageAfterCount, usageByDay } from './dailyUsage'
import { estimateCounterRow } from './inventory'
import { countedLabelVN } from './dateVN'

describe('missingUsageDays', () => {
    it('chỉ ngày đã qua chưa lưu, không gồm hôm nay', () => {
        const stored = { '2026-10-02': {}, '2026-10-04': { ca_phe: 5 } }
        expect(missingUsageDays(stored, '2026-10-01', '2026-10-06')).toEqual(['2026-10-01', '2026-10-03', '2026-10-05'])
    })
    it('lưu đủ / fromDay không trước hôm nay → rỗng', () => {
        expect(missingUsageDays({ '2026-10-01': {} }, '2026-10-01', '2026-10-02')).toEqual([])
        expect(missingUsageDays({}, '2026-10-06', '2026-10-06')).toEqual([])
    })
    it('qua ranh giới tháng', () => {
        expect(missingUsageDays({}, '2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
    })
})

describe('usageByDay', () => {
    const recipes = [{ product_id: 'p1', ingredient: 'ca_phe', amount: 10 }]
    const extras = { x1: [{ ingredient: 'sua', amount: 30 }] }
    const order = (created_at, qty, extra_ids = [], over = {}) => ({ created_at, order_items: [{ product_id: 'p1', quantity: qty, extra_ids }], ...over })

    it('chia theo NGÀY VN (23:30 và 00:30 giờ VN rơi vào 2 ngày dù cùng ngày UTC), gồm extras', () => {
        const orders = [order('2026-10-01T23:30:00+07:00', 2), order('2026-10-02T00:30:00+07:00', 3, ['x1'])]
        expect(usageByDay(orders, ['2026-10-01', '2026-10-02'], recipes, extras)).toEqual({
            '2026-10-01': { ca_phe: 20 },
            '2026-10-02': { ca_phe: 30, sua: 90 },
        })
    })
    it('ngày không có đơn vẫn có entry {} (để lưu dòng rỗng)', () => {
        expect(usageByDay([order('2026-10-02T10:00:00+07:00', 1)], ['2026-10-01', '2026-10-02'], recipes, extras))
            .toEqual({ '2026-10-01': {}, '2026-10-02': { ca_phe: 10 } })
        expect(usageByDay([], ['2026-10-01'], recipes, extras)).toEqual({ '2026-10-01': {} })
    })
    it('bỏ đơn đã xoá và đơn ngoài danh sách ngày', () => {
        const orders = [
            order('2026-10-01T10:00:00+07:00', 5, [], { deleted_at: '2026-10-01T11:00:00Z' }),
            order('2026-10-09T10:00:00+07:00', 5),
            order('2026-10-01T12:00:00+07:00', 1),
        ]
        expect(usageByDay(orders, ['2026-10-01'], recipes, extras)).toEqual({ '2026-10-01': { ca_phe: 10 } })
    })
})

describe('đếm giữa ngày: trừ đơn SAU giờ đếm', () => {
    const recipes = [{ product_id: 'p1', ingredient: 'ly', amount: 1 }]
    const order = (created_at, qty = 1) => ({ created_at, order_items: [{ product_id: 'p1', quantity: qty, extra_ids: [] }] })
    const row = (over = {}) => ({ ingredient: 'ly', counter_stock: 20, restock_since_count: 0, warehouse_stock: 0, counter_counted_on: '2026-10-12', counter_counted_at: '2026-10-12T10:00:00+07:00', ...over })

    it('chỉ tính đơn tạo từ giờ đếm trở đi (đơn trước giờ đếm đã nằm trong số đếm)', () => {
        const orders = { '2026-10-12': [order('2026-10-12T09:00:00+07:00', 3), order('2026-10-12T11:00:00+07:00')] }
        expect(usageAfterCount([row()], orders, recipes, {})).toEqual({ ly: 1 })
    })
    it('dòng không có giờ đếm bị bỏ qua', () => {
        expect(usageAfterCount([row({ counter_counted_at: null })], { '2026-10-12': [order('2026-10-12T11:00:00+07:00')] }, recipes, {})).toEqual({})
    })
    it('đếm 20 ly, bán 1 ly sau đó → 19 (ngay trong ngày đếm)', () => {
        const e = estimateCounterRow(row(), {}, { today: '2026-10-12', fromDay: '2026-10-12', afterCount: { ly: 1 } })
        expect(e.counter_stock).toBe(19)
        expect(e.counter_estimated).toBe(true)
    })
    it('đếm hôm nay không có giờ đếm (entry cũ) → giữ số thô', () => {
        const r = row({ counter_counted_at: null })
        expect(estimateCounterRow(r, {}, { today: '2026-10-12', fromDay: '2026-10-12', afterCount: { ly: 1 } })).toBe(r)
    })
    it('đếm hôm qua: trừ phần sau giờ đếm của hôm qua + cả ngày hôm nay', () => {
        const r = row({ counter_counted_on: '2026-10-11', counter_counted_at: '2026-10-11T15:00:00+07:00' })
        const e = estimateCounterRow(r, { '2026-10-11': { ly: 99 }, '2026-10-12': { ly: 4 } }, { today: '2026-10-12', fromDay: '2026-10-12', afterCount: { ly: 2 } })
        expect(e.counter_stock).toBe(14) // 20 − 2 (hôm qua sau 15h) − 4 (hôm nay); 99 là cả ngày hôm qua, không được trừ
    })
})

describe('countedLabelVN', () => {
    it('có giờ → "HH:mm dd/mm" theo giờ VN; không có → chỉ ngày; withYear thêm năm', () => {
        expect(countedLabelVN('2026-10-12', '2026-10-12T03:05:00Z')).toBe('10:05 12/10')
        expect(countedLabelVN('2026-10-12', null)).toBe('12/10')
        expect(countedLabelVN('2026-10-12', null, true)).toBe('12/10/2026')
    })
})
