import { describe, it, expect } from 'vitest'
import { ceilToBigUnit, draftFromItems, draftToItems, draftTotals, fmtQty, isTrivialQty, parseQtyInput, shortNames, toQty } from './warehouseTransfer'

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

describe('parseQtyInput / isTrivialQty', () => {
    it('gõ kg / lít đổi sang g / ml; còn lại giữ nguyên', () => {
        expect(parseQtyInput('5kg', 'g')).toBe('5000')
        expect(parseQtyInput('1,5 KG', 'g')).toBe('1500')
        expect(parseQtyInput('2 lít', 'ml')).toBe('2000')
        expect(parseQtyInput('2 lít', 'g')).toBe('2 lít') // sai loại đơn vị
        expect(parseQtyInput('5kg', 'cái')).toBe('5kg')
        expect(parseQtyInput('5000', 'g')).toBe('5000')
    })
    it('số quá nhỏ chỉ với g/ml', () => {
        expect(isTrivialQty(8, 'g')).toBe(true)
        expect(isTrivialQty(10, 'g')).toBe(false)
        expect(isTrivialQty(3, 'cái')).toBe(false)
    })
})

describe('shortNames', () => {
    it('bỏ phần đầu chung của tên chi nhánh', () => {
        expect(shortNames(['KOPHIN 62 TRƯỜNG SA', 'KOPHIN 34B XÔ VIẾT', 'KOPHIN 7 HUỲNH MẪN ĐẠT']))
            .toEqual(['62 TRƯỜNG SA', '34B XÔ VIẾT', '7 HUỲNH MẪN ĐẠT'])
    })
    it('giữ nguyên khi không có phần chung hoặc sẽ làm trùng tên', () => {
        expect(shortNames(['Hoàng Sa', 'Trường Sa'])).toEqual(['Hoàng Sa', 'Trường Sa'])
        expect(shortNames(['A B', 'A B'])).toEqual(['A B', 'A B'])
        expect(shortNames(['Kophin Sa'])).toEqual(['Kophin Sa'])
    })
})

describe('bảng soạn kho nhập tay', () => {
    it('ô trống / 0 / chữ không thành dòng phiếu; dấu phẩy thập phân hợp lệ', () => {
        const draft = { a: { ca_phe: '2,5', sua: '', duong: '0', muoi: 'abc' }, b: { ca_phe: '3' } }
        expect(draftToItems(draft, { ca_phe: 'kg' })).toEqual([
            { address_id: 'a', ingredient: 'ca_phe', unit: 'kg', qty: 2.5 },
            { address_id: 'b', ingredient: 'ca_phe', unit: 'kg', qty: 3 },
        ])
        expect(draftTotals(draft)).toEqual({ ca_phe: 5.5, sua: 0, duong: 0, muoi: 0 })
    })

    it('khứ hồi phiếu đã lưu', () => {
        const items = [{ address_id: 'a', ingredient: 'ca_phe', unit: 'kg', qty: 4 }]
        expect(draftToItems(draftFromItems(items), { ca_phe: 'kg' })).toEqual(items)
    })

    it('số lẻ dưới 0.05 coi như 0 — khớp việc lưu', () => {
        expect(toQty('0.04')).toBe(0)
        expect(draftToItems({ a: { x: '0.04' } })).toEqual([])
    })
})
