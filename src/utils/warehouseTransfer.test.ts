import { describe, it, expect } from 'vitest'
import { draftFromItems, draftToItems, draftTotals, fmtQty, shortNames, toQty } from './warehouseTransfer'

describe('fmtQty', () => {
    it('g/ml đủ lớn ghi thêm kg/lít, nhỏ hoặc đơn vị khác giữ nguyên', () => {
        expect(fmtQty(10000, 'g')).toBe('10.000 g (10 kg)')
        expect(fmtQty(1500, 'g')).toBe('1.500 g (1,5 kg)')
        expect(fmtQty(2000, 'ml')).toBe('2.000 ml (2 lít)')
        expect(fmtQty(900, 'g')).toBe('900 g')
        expect(fmtQty(30, 'cái')).toBe('30 cái')
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
