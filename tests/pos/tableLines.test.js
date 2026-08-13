// POS (dine_in) — mergeTableLines: gộp các đợt gọi món của một bàn thành tờ hoá đơn.
// Nguồn: src/services/orderService.ts
//
// Đây là dòng chữ nhân viên đọc cho khách lúc tính tiền ("2 Trà đá, 1 Cà phê sữa"),
// nên sai gộp = thu sai tiền. Dùng ở 2 nơi: fetchOpenTables (gộp từ DB) và POSContext
// (cộng lạc quan đợt vừa gửi) — cả hai đều dựa vào việc hàm này KHÔNG sửa mảng cũ.

import { describe, it, expect } from 'vitest'
import { mergeTableLines, tableLineName } from '../../src/services/orderService'

describe('tableLineName', () => {
    it('gắn topping vào nhãn để hai ly khác topping không gộp làm một', () => {
        const a = tableLineName('Cacao Cà Phê', ['Trân châu'])
        const b = tableLineName('Cacao Cà Phê', [])

        expect(a).toBe('Cacao Cà Phê (Trân châu)')
        expect(mergeTableLines([{ name: a, qty: 1 }], [{ name: b, qty: 2 }])).toEqual([
            { name: 'Cacao Cà Phê (Trân châu)', qty: 1 },
            { name: 'Cacao Cà Phê', qty: 2 },
        ])
    })

    it('bỏ cách trả tiền khỏi nhãn — không phải topping', () => {
        expect(tableLineName('Trà đá', ['Tiền mặt'])).toBe('Trà đá')
        expect(tableLineName('Trà đá', ['Ít đá', 'MoMo'])).toBe('Trà đá (Ít đá)')
    })

    it('chuỗi options rỗng từ DB không sinh ngoặc rỗng', () => {
        expect(tableLineName('Trà đá', ''.split(', '))).toBe('Trà đá')
    })
})

describe('mergeTableLines', () => {
    it('cộng dồn dòng trùng tên, giữ thứ tự gặp đầu tiên', () => {
        const round1 = [{ name: 'Trà đá', qty: 1 }, { name: 'Cà phê sữa', qty: 1 }]
        const round2 = [{ name: 'Cà phê sữa', qty: 2 }, { name: 'Cacao', qty: 1 }]

        expect(mergeTableLines(round1, round2)).toEqual([
            { name: 'Trà đá', qty: 1 },
            { name: 'Cà phê sữa', qty: 3 },
            { name: 'Cacao', qty: 1 },
        ])
    })

    it('không sửa mảng đầu vào (state cũ của React phải nguyên vẹn)', () => {
        const base = [{ name: 'Trà đá', qty: 1 }]
        const add = [{ name: 'Trà đá', qty: 2 }]

        const out = mergeTableLines(base, add)

        expect(base).toEqual([{ name: 'Trà đá', qty: 1 }])
        expect(add).toEqual([{ name: 'Trà đá', qty: 2 }])
        expect(out[0]).not.toBe(base[0])
    })

    it('bàn trống + đợt đầu tiên = chính đợt đó', () => {
        expect(mergeTableLines([], [{ name: 'Bạc xỉu', qty: 2 }])).toEqual([{ name: 'Bạc xỉu', qty: 2 }])
    })
})
