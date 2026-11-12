import { describe, expect, it } from 'vitest'
import { computeIngredientNoise, findMissingCupCandidates } from './inventory'

// Quán giả: 2 món cà phê giống hệt nhau + extra "Lớn" (ly 350 → ly 470, +8g cà phê).
const products = [
    { id: 'p1', name: 'Cà Phê Đen', price: 20000, is_active: true },
    { id: 'p2', name: 'Americano', price: 20000, is_active: true },
]
const recipes = ['p1', 'p2'].flatMap(product_id => [
    { product_id, ingredient: 'ly_350ml', amount: 1 },
    { product_id, ingredient: 'nắp', amount: 1 },
    { product_id, ingredient: 'cà_phê', amount: 17 },
])
const productExtras = { p1: [{ id: 'L', name: 'Lớn', price: 5000 }], p2: [{ id: 'L', name: 'Lớn', price: 5000 }] }
const extraIngredients = { L: [{ ingredient: 'cà_phê', amount: 8 }, { ingredient: 'ly_350ml', amount: -1 }, { ingredient: 'ly_470ml', amount: 1 }] } as never
const ingredientsList = [
    { ingredient: 'cà_phê', unit_cost: 248 }, { ingredient: 'ly_350ml', unit_cost: 600 }, { ingredient: 'ly_470ml', unit_cost: 660 },
    { ingredient: 'nắp', unit_cost: 280 }, { ingredient: 'bịch_t', unit_cost: 27500 }, { ingredient: 'ống_hút', unit_cost: 25038 },
]
const base = { ingredientsList, recipes, products, extraIngredients, productExtras } as never
const find = (haoHutByIngredient: Record<string, number>, extra: object = {}) =>
    findMissingCupCandidates({ ...(base as object), haoHutByIngredient, ...extra } as never)
// Nhiễu lịch sử lớn (như cà phê ±147g, ly ±7) — ly/nắp vẫn phải đếm chính xác từng cái.
const noisy = { cà_phê: 147, ly_350ml: 5.6, ly_470ml: 7.4, nắp: 9.6 }

describe('findMissingCupCandidates', () => {
    it('4 ly Lớn không bấm bill: ly 470 hụt 4 chốt đúng 4 ly (không phải 5) dù cà phê nhiễu', () => {
        const [c] = find({ cà_phê: -123, ly_470ml: -4, ly_350ml: 4, nắp: -4, bịch_t: 0, ống_hút: 0 }, { noiseByIngredient: noisy })
        expect(c.productName).toContain('(Lớn)')
        expect(c.estimatedCups).toBe(4)
    })
    it('két dư đúng tiền 4 ly → cashMatch + xếp đầu', () => {
        const r = find({ cà_phê: -100, ly_470ml: -4, ly_350ml: 4, nắp: -4 }, { noiseByIngredient: noisy, cashDiff: 100000 })
        expect(r[0].estimatedCups).toBe(4)
        expect(r[0].cashMatch).toBe(true)
    })
    it('món giống hệt nhau được gộp: có similar', () => {
        const [c] = find({ cà_phê: -100, ly_470ml: -4, ly_350ml: 4, nắp: -4 })
        expect(c.similar.length).toBe(1)
    })
    it('ngày bình thường (không hụt) → không có thẻ', () => {
        expect(find({ cà_phê: 0, ly_470ml: 0, ly_350ml: 0, nắp: 0, bịch_t: 0 })).toEqual([])
    })
    it('chỉ bịch T + ống hút hụt → bỏ qua', () => {
        expect(find({ cà_phê: 0, nắp: 0, bịch_t: -3, ống_hút: -10 })).toEqual([])
    })
})

// Quán thật: "Bình lớn" (ly 470 −1, nắp −1, +0đ) chỉ có nghĩa khi đi cùng "Lớn" (ly 350 → 470, +11g cà phê, +8g đường, +6k).
describe('phân rã từng ly (cups)', () => {
    const args = {
        products: [
            { id: 'den', name: 'Cà Phê Đen', price: 14000, is_active: true },
            { id: 'sua', name: 'Cà Phê Sữa', price: 16000, is_active: true },
        ],
        recipes: [
            ...[['ly_350ml', 1], ['nắp', 1], ['cà_phê', 17], ['đường', 8]].map(([ingredient, amount]) => ({ product_id: 'den', ingredient, amount })),
            ...[['ly_350ml', 1], ['nắp', 1], ['cà_phê', 17], ['sữa_đặc', 40]].map(([ingredient, amount]) => ({ product_id: 'sua', ingredient, amount })),
        ],
        productExtras: {
            den: [{ id: 'L', name: 'Lớn', price: 6000 }, { id: 'B', name: 'Bình', price: 0 }, { id: 'BL', name: 'Bình lớn', price: 0 }],
            sua: [{ id: 'N', name: 'Ngọt', price: 0 }],
        },
        extraIngredients: {
            L: [{ ingredient: 'cà_phê', amount: 11 }, { ingredient: 'đường', amount: 8 }, { ingredient: 'ly_350ml', amount: -1 }, { ingredient: 'ly_470ml', amount: 1 }],
            B: [{ ingredient: 'ly_350ml', amount: -1 }, { ingredient: 'nắp', amount: -1 }],
            BL: [{ ingredient: 'ly_470ml', amount: -1 }, { ingredient: 'nắp', amount: -1 }],
            N: [{ ingredient: 'sữa_đặc', amount: 20 }],
        },
        ingredientsList: ['cà_phê', 'đường', 'sữa_đặc', 'ly_350ml', 'ly_470ml', 'nắp'].map(ingredient => ({ ingredient, unit_cost: 100 })),
    }
    const cupsOf = (haoHutByIngredient: Record<string, number>, cashDiff: number | null = null) =>
        findMissingCupCandidates({ ...args, haoHutByIngredient, cashDiff } as never)[0]

    it('Bình lớn = Lớn + Bình lớn (20k, không ly không nắp); không có món ma "Bình lớn" 14k', () => {
        // 1 cà phê sữa ngọt + 4 bình lớn: 17 + 4×28 cà phê, 4×16 đường, 60 sữa đặc, 1 ly 350, 1 nắp.
        const c = cupsOf({ cà_phê: -129, đường: -64, sữa_đặc: -60, ly_350ml: -1, ly_470ml: 0, nắp: -1 }, 96000)
        expect(c.cups.map(x => `${x.name} ${x.price}`).sort()).toEqual([
            'Cà Phê Sữa (Ngọt) 16000', ...Array(4).fill('Cà Phê Đen (Lớn + Bình lớn) 20000'),
        ])
        expect(c.restCups).toBe(0)
    })
    it('trừ dần hao hụt: 40ml sữa đặc chỉ đủ 1 ly cà phê sữa, 2 ly còn lại là cà phê đen', () => {
        const c = cupsOf({ cà_phê: -51, đường: -16, sữa_đặc: -40, ly_350ml: -3, ly_470ml: 0, nắp: -3 })
        expect(c.cups.map(x => x.name).sort()).toEqual(['Cà Phê Sữa', 'Cà Phê Đen', 'Cà Phê Đen'].sort())
    })
    it('kho hoà nhau thì két chọn: 28g cà phê + 16g đường không ly = 1 bình lớn (20k), không phải 2 bình (28k)', () => {
        const loss = { cà_phê: -34, đường: -16, sữa_đặc: 0, ly_350ml: 0, ly_470ml: 0, nắp: 0 }
        expect(cupsOf(loss, 28000).cups.map(x => x.name)).toEqual(['Cà Phê Đen (Bình)', 'Cà Phê Đen (Bình)'])
        expect(cupsOf({ ...loss, cà_phê: -28 }, 20000).cups.map(x => x.name)).toEqual(['Cà Phê Đen (Lớn + Bình lớn)'])
    })
    it('két dư mà kho không hụt → không sinh ly nào', () => {
        expect(findMissingCupCandidates({ ...args, haoHutByIngredient: { cà_phê: 0, đường: 0, sữa_đặc: 0, ly_350ml: 0, ly_470ml: 0, nắp: 0 }, cashDiff: 50000 } as never)).toEqual([])
    })
})

describe('computeIngredientNoise', () => {
    it('1 ngày bán thiếu thật không làm phồng độ nhiễu (median/MAD)', () => {
        const days = Object.fromEntries([-1, 0, 1, 0, -1, 1, -200].map((v, i) => [`d${i}`, { cà_phê: v }]))
        expect(computeIngredientNoise(days).cà_phê).toBeLessThan(3)
    })
})
