import { describe, it, expect } from 'vitest'
import { missingUsageDays, usageByDay } from './dailyUsage'

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
