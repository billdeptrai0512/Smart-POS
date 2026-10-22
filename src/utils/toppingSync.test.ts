import { describe, it, expect } from 'vitest'
import { toppingSyncPlan } from './toppingSync'

const row = (ingredient: string, amount: number) => ({ ingredient, amount })

describe('toppingSyncPlan', () => {
    it('0 dòng: bỏ nguồn nếu đang có, không thì không làm gì', () => {
        expect(toppingSyncPlan([], 0, 0, true)).toEqual({ kind: 'clear' })
        expect(toppingSyncPlan([], 0, 0, false)).toEqual({ kind: 'none' })
    })
    it('1 dòng: mua sẵn, chỉ ghi khi có lượng', () => {
        expect(toppingSyncPlan([row('hạt', 20)], 0, 0, false)).toEqual({ kind: 'direct', source: { ingredient: 'hạt', amount: 20 } })
        expect(toppingSyncPlan([row('hạt', 0)], 0, 0, true)).toEqual({ kind: 'none' })
    })
    it('≥2 dòng: tự nấu chỉ khi đủ sản lượng mẻ và lượng mỗi phần', () => {
        const rows = [row('bột', 50), row('sữa', 200)]
        expect(toppingSyncPlan(rows, 500, 60, false)).toEqual({ kind: 'cook' })
        expect(toppingSyncPlan(rows, 0, 60, true)).toEqual({ kind: 'none' })
        expect(toppingSyncPlan(rows, 500, 0, true)).toEqual({ kind: 'none' })
    })
})
