import { describe, it, expect } from 'vitest'
import { calculateEstimatedConsumption, forecastFromWeeks, orderItemsOf, type ExtraIngredients, type RecipeRow } from './inventory'

const recipes: RecipeRow[] = [{ product_id: 'ts', ingredient: 'tra', amount: 10 }]
// Topping gán nguồn nằm CHUNG map với extras (fetchExtraIngredientsWithToppings): 'tc' → 30g trân châu nấu (thành phẩm).
const ext: ExtraIngredients = { tc: [{ ingredient: 'tran_chau_nau', amount: 30 }], size_l: [{ ingredient: 'ly_l', amount: 1 }] }

describe('tiêu hao topping theo nguồn', () => {
    it('đơn từ server (topping_ids) trừ nguồn × số lượng, cạnh extras', () => {
        const order = { order_items: [{ product_id: 'ts', quantity: 2, extra_ids: ['size_l'], topping_ids: ['tc'] }] }
        expect(calculateEstimatedConsumption(orderItemsOf(order), recipes, ext)).toEqual({ tra: 20, ly_l: 2, tran_chau_nau: 60 })
    })

    it('đơn offline/giỏ (toppings là object) cũng tính', () => {
        const order = { cart: [{ productId: 'ts', qty: 1, extras: [], toppings: [{ id: 'tc' }] }] }
        expect(calculateEstimatedConsumption(orderItemsOf(order), recipes, ext)).toEqual({ tra: 10, tran_chau_nau: 30 })
    })

    it('topping chưa gán nguồn → không tiêu hao (hành vi cũ)', () => {
        const order = { order_items: [{ product_id: 'ts', quantity: 1, topping_ids: ['chua_co_nguon'] }] }
        expect(calculateEstimatedConsumption(orderItemsOf(order), recipes, ext)).toEqual({ tra: 10 })
    })

    it('dự báo từ tuần mẫu cũng đếm topping', () => {
        const week = [[{ product_id: 'ts', quantity: 1, extra_ids: [], topping_ids: ['tc'] }]]
        expect(forecastFromWeeks(week, recipes, ext)).toEqual({ tra: 10, tran_chau_nau: 30 })
    })
})
