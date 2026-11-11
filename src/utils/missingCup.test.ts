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

describe('computeIngredientNoise', () => {
    it('1 ngày bán thiếu thật không làm phồng độ nhiễu (median/MAD)', () => {
        const days = Object.fromEntries([-1, 0, 1, 0, -1, 1, -200].map((v, i) => [`d${i}`, { cà_phê: v }]))
        expect(computeIngredientNoise(days).cà_phê).toBeLessThan(3)
    })
})
