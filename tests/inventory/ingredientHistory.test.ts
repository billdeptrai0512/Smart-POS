// Phân loại thẻ lịch sử nhập kho + công nợ.
// Nguồn: src/utils/ingredientHistory.ts

import { describe, it, expect } from 'vitest'
import { kindOf, debtOf } from '../../src/utils/ingredientHistory'

describe('kindOf', () => {
    it('mặc định là phiếu nhập', () => {
        expect(kindOf({})).toBe('restock')
    })
    it('nhận đúng từng loại', () => {
        expect(kindOf({ is_withdrawal: true })).toBe('withdrawal')
        expect(kindOf({ is_production: true })).toBe('production')
        expect(kindOf({ metadata: { adjustment: true } })).toBe('adjustment')
    })
    it('đã hủy thắng mọi loại gốc (phiếu hủy vẫn mang cờ gốc)', () => {
        expect(kindOf({ metadata: { cancelled: true, adjustment: true }, is_withdrawal: true })).toBe('cancelled')
    })
    it('rút ra quầy ưu tiên trước sản xuất và hiệu chỉnh', () => {
        expect(kindOf({ is_withdrawal: true, is_production: true, metadata: { adjustment: true } })).toBe('withdrawal')
    })
})

describe('debtOf', () => {
    const inv = (amount: number, payments: { amount: number }[] = []) => ({ amount, payments })

    it('còn thiếu tiền → owing', () => {
        expect(debtOf(inv(100000, [{ amount: 40000 }]))).toBe('owing')
        expect(debtOf(inv(100000))).toBe('owing')
    })
    it('trả đủ hoặc dư → paid', () => {
        expect(debtOf(inv(100000, [{ amount: 60000 }, { amount: 40000 }]))).toBe('paid')
        expect(debtOf(inv(100000, [{ amount: 120000 }]))).toBe('paid')
    })
    it('phiếu 0đ coi như đã trả; thiếu amount/payments không ném lỗi', () => {
        expect(debtOf(inv(0))).toBe('paid')
        expect(debtOf({})).toBe('paid')
    })
    it('chỉ phiếu nhập có công nợ: hủy / rút / sản xuất / hiệu chỉnh → null', () => {
        expect(debtOf({ amount: 100000, metadata: { cancelled: true } })).toBeNull()
        expect(debtOf({ amount: 100000, is_withdrawal: true })).toBeNull()
        expect(debtOf({ amount: 100000, is_production: true })).toBeNull()
        expect(debtOf({ amount: 100000, metadata: { adjustment: true } })).toBeNull()
    })
})
