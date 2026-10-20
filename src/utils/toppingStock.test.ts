import { describe, it, expect } from 'vitest'
import { isIngredientReferenced } from './toppingStock'

const base = { recipes: [], extraIngredients: {}, batchKeys: new Set<string>(), toppingIngredients: {}, excludeId: 't1' }

describe('isIngredientReferenced', () => {
    it('không ai dùng → có thể dọn (nguồn của chính topping đang xoá không tính)', () => {
        expect(isIngredientReferenced('thach', { ...base, extraIngredients: { t1: [{ ingredient: 'thach', amount: 5 }] } })).toBe(false)
    })
    it('thành phẩm trùng tên / công thức món / tuỳ chọn thêm / nguồn topping khác / công thức topping khác → giữ lại', () => {
        expect(isIngredientReferenced('thach', { ...base, batchKeys: new Set(['thach']) })).toBe(true)
        expect(isIngredientReferenced('thach', { ...base, recipes: [{ product_id: 'p', ingredient: 'thach', amount: 1 }] })).toBe(true)
        expect(isIngredientReferenced('thach', { ...base, extraIngredients: { e1: [{ ingredient: 'thach', amount: 1 }] } })).toBe(true)
        expect(isIngredientReferenced('thach', { ...base, extraIngredients: { t2: [{ ingredient: 'thach', amount: 1 }] } })).toBe(true)
        expect(isIngredientReferenced('thach', { ...base, toppingIngredients: { t2: [{ ingredient: 'thach' }] } })).toBe(true)
    })
})
