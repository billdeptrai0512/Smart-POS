import { describe, it, expect } from 'vitest'
import { ceilToBigUnit, fmtQty, isTrivialQty } from './warehouseTransfer'

describe('fmtQty', () => {
    it('không quy cách → số + đơn vị gốc, không tự quy đổi kg/lít', () => {
        expect(fmtQty(10000, 'g')).toBe('10.000 g')
        expect(fmtQty(2000, 'ml')).toBe('2.000 ml')
        expect(fmtQty(30, 'cái')).toBe('30 cái')
    })
    it('có quy cách → đọc theo đơn vị nhập kho (cả cấp 2)', () => {
        const cfg = { pack_size: 380, pack_unit: 'lon' }
        expect(fmtQty(7704, 'g', cfg)).toBe('20 lon + 104 g')
        expect(fmtQty(760, 'g', cfg)).toBe('2 lon')
        expect(fmtQty(9120, 'g', { ...cfg, pack2_size: 12, pack2_unit: 'thùng' })).toBe('2 thùng')
    })
})

describe('ceilToBigUnit', () => {
    it('làm tròn lên theo đơn vị lớn nhất; không quy cách thì giữ nguyên', () => {
        expect(ceilToBigUnit(7704, 'g')).toBe(7704)
        expect(ceilToBigUnit(7704, 'g', { pack_size: 1000, pack_unit: 'hộp' })).toBe(8000)
        expect(ceilToBigUnit(6, 'hộp', { pack_size: 1, pack_unit: 'hộp', pack2_size: 12, pack2_unit: 'thùng' })).toBe(12)
        expect(ceilToBigUnit(24, 'hộp', { pack_size: 1, pack_unit: 'hộp', pack2_size: 12, pack2_unit: 'thùng' })).toBe(24)
    })
})

describe('isTrivialQty', () => {
    it('vài g/ml là nhiễu; đơn vị khác không', () => {
        expect(isTrivialQty(8, 'g')).toBe(true)
        expect(isTrivialQty(10, 'g')).toBe(false)
        expect(isTrivialQty(3, 'cái')).toBe(false)
    })
})
