import { describe, it, expect } from 'vitest'
import { computeBalance, computeHaoHut, parseInventoryReport } from './inventory'

describe('computeBalance / computeHaoHut', () => {
    it('hao hụt = Cuối kỳ − (Đầu kỳ + Nhập thêm − Sử dụng)', () => {
        const args = { inventoryValue: '8', restockValue: '5', openingValue: '10', used: 6.04 }
        expect(computeBalance(args)).toEqual({ openingNum: 10, usedNum: 6, lyThuyet: 9, haoHut: -1 })
        expect(computeHaoHut(args)).toBe(-1)
    })
    it('chưa nhập Cuối kỳ → null (không phải 0)', () => {
        expect(computeHaoHut({ inventoryValue: '', openingValue: '10', used: 1 })).toBeNull()
        expect(computeHaoHut({ openingValue: '10' })).toBeNull()
    })
    it('Đầu kỳ rỗng/thiếu rơi về openingFallback', () => {
        expect(computeBalance({ inventoryValue: '3', openingFallback: 4 }).lyThuyet).toBe(4)
        expect(computeBalance({ inventoryValue: '3', openingValue: '', openingFallback: 4 }).lyThuyet).toBe(0)
    })
})

describe('parseInventoryReport', () => {
    it('mảng, chuỗi JSON → mảng; hỏng/không phải mảng → null', () => {
        expect(parseInventoryReport([{ a: 1 }])).toEqual([{ a: 1 }])
        expect(parseInventoryReport('[{"a":1}]')).toEqual([{ a: 1 }])
        expect(parseInventoryReport('{oops')).toBeNull()
        expect(parseInventoryReport(null)).toBeNull()
        expect(parseInventoryReport({})).toBeNull()
    })
})
