// Menu — gợi ý tùy chọn thêm học từ các món khác của quán: suggestExtras.
// Nguồn: src/utils/suggestExtras.ts

import { describe, it, expect } from 'vitest'
import { suggestExtras } from '../../src/utils/suggestExtras'

const prod = (id: string) => ({ id })
const div = (id: string) => ({ id, is_divider: true })
const recipe = (product_id: string, ingredient: string, amount: number) => ({ product_id, ingredient, amount })
const extra = (id: string, name: string, price = 0) => ({ id, name, price })

describe('suggestExtras', () => {
    // Cà phê: A (cà phê 20g, ly350 1), B (cà phê 10g, ly350 1), C = món đang xem (cà phê 30g, ly350 1)
    const products = [div('d1'), prod('A'), prod('B'), prod('C')]
    const recipes = [
        recipe('A', 'cà_phê', 20), recipe('A', 'ly_350ml', 1),
        recipe('B', 'cà_phê', 10), recipe('B', 'ly_350ml', 1),
        recipe('C', 'cà_phê', 30), recipe('C', 'ly_350ml', 1),
    ]
    const extrasByProduct = { A: [extra('eA', 'Lớn', 5000)], B: [extra('eB', 'lớn', 5000)], C: [] }
    const extraIngs = {
        eA: [{ ingredient: 'cà_phê', amount: 10, unit: 'g' }, { ingredient: 'ly_350ml', amount: -1 }, { ingredient: 'ly_470ml', amount: 1 }],
        eB: [{ ingredient: 'cà_phê', amount: 5, unit: 'g' }, { ingredient: 'ly_350ml', amount: -1 }, { ingredient: 'ly_470ml', amount: 1 }],
    }
    const run = (over = {}) => suggestExtras({ productId: 'C', products, extrasByProduct, extraIngs, recipes, ...over })

    it('nguyên liệu có trong định lượng → quy theo tỉ lệ; bao bì/đổi ly → lượng tuyệt đối', () => {
        const [s] = run()
        expect(s.name).toBe('Lớn')
        expect(s.price).toBe(5000)
        expect(s.count).toBe(2)
        const by = Object.fromEntries(s.items.map(i => [i.ingredient, i.amount]))
        expect(by.cà_phê).toBe(15) // tỉ lệ 0.5 × 30g
        expect(by.ly_350ml).toBe(-1) // định lượng có ly_350ml → ×1
        expect(by.ly_470ml).toBe(1) // không có trong định lượng → tuyệt đối
    })

    it('món này không dùng nguyên liệu quy tỉ lệ → bỏ qua nguyên liệu đó', () => {
        const items = run({ recipes: recipes.filter(r => !(r.product_id === 'C' && r.ingredient === 'cà_phê')) })[0].items
        expect(items.some(i => i.ingredient === 'cà_phê')).toBe(false)
    })

    it('chỉ có ở 1 món → không gợi ý; tên đã có ở món này → không gợi ý', () => {
        expect(run({ extrasByProduct: { A: [extra('eA', 'Lớn')], B: [], C: [] } })).toEqual([])
        expect(run({ extrasByProduct: { ...extrasByProduct, C: [extra('eC', 'LỚN')] } })).toEqual([])
    })

    it('ưu tiên mẫu cùng danh mục khi có ≥2 món', () => {
        // Thêm danh mục khác: D, E có "Lớn" cà phê +100 → không được lẫn vào mẫu cùng danh mục của C
        const p2 = [...products, div('d2'), prod('D'), prod('E')]
        const e2 = { ...extrasByProduct, D: [extra('eD', 'Lớn', 9000)], E: [extra('eE', 'Lớn', 9000)] }
        const i2 = { ...extraIngs, eD: [{ ingredient: 'cà_phê', amount: 100 }], eE: [{ ingredient: 'cà_phê', amount: 100 }] }
        const r2 = [...recipes, recipe('D', 'cà_phê', 10), recipe('E', 'cà_phê', 10)]
        const [s] = suggestExtras({ productId: 'C', products: p2, extrasByProduct: e2, extraIngs: i2, recipes: r2 })
        expect(s.price).toBe(5000)
        expect(s.items.find(i => i.ingredient === 'cà_phê')?.amount).toBe(15)
    })

    it('tùy chọn THÊM nguyên liệu (món nguồn chưa có) → chép lượng tuyệt đối, kể cả khi món này chưa dùng', () => {
        // "Ngọt": A thêm đường +5 (định lượng A không có đường); B đã có đường 8 và thêm +8; C chưa có đường
        const rec = [...recipes, recipe('B', 'đường', 8)]
        const e = { A: [extra('n1', 'Ngọt')], B: [extra('n2', 'Ngọt')], C: [] }
        const i = { n1: [{ ingredient: 'đường', amount: 5, unit: 'g' }], n2: [{ ingredient: 'đường', amount: 8, unit: 'g' }] }
        const [s] = suggestExtras({ productId: 'C', products, extrasByProduct: e, extraIngs: i, recipes: rec })
        expect(s.items).toEqual([{ ingredient: 'đường', amount: 5, unit: 'g' }]) // chỉ tính dòng "thêm" của A
    })

    it('hai món lệch giá → chọn 1 giá có thật, không lấy trung bình', () => {
        const e = { A: [extra('p1', 'Bình', 0)], B: [extra('p2', 'Bình', 6000)], C: [] }
        expect(suggestExtras({ productId: 'C', products, extrasByProduct: e, extraIngs: {}, recipes })[0].price).toBe(6000)
    })

    it('tùy chọn không có nguyên liệu (vd. Ít đá) → chỉ tên + giá', () => {
        const e = { A: [extra('x1', 'Ít đá')], B: [extra('x2', 'Ít đá')], C: [] }
        expect(suggestExtras({ productId: 'C', products, extrasByProduct: e, extraIngs: {}, recipes })).toEqual([
            { name: 'Ít đá', price: 0, count: 2, items: [] },
        ])
    })
})
