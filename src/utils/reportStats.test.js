import { describe, it, expect } from 'vitest'
import { splitExpenses, aggregateOrderStats } from './reportStats'

describe('splitExpenses (thực chi model)', () => {
    it('sums non-refill expenses into dailyExpense', () => {
        const expenses = [
            { amount: 100 },
            { amount: 200 },
        ]
        const { dailyExpense, refillNvl, refillFreeForm } = splitExpenses(expenses)
        expect(dailyExpense).toBe(300)
        expect(refillNvl).toBe(0)
        expect(refillFreeForm).toBe(0)
    })

    it('puts NVL refill (is_refill, no free_form) into refillNvl', () => {
        const expenses = [
            { amount: 5000, is_refill: true, metadata: { ingredient: 'coffee_g', qty: 100 } },
        ]
        const { refillNvl, dailyExpense } = splitExpenses(expenses)
        expect(refillNvl).toBe(5000)
        expect(dailyExpense).toBe(0)
    })

    it('puts free-form refill (sau ca) into refillFreeForm', () => {
        const expenses = [
            { amount: 75, is_refill: true, metadata: { free_form: true } },
        ]
        const { refillFreeForm, refillNvl } = splitExpenses(expenses)
        expect(refillFreeForm).toBe(75)
        expect(refillNvl).toBe(0)
    })

    it('counts legacy is_fixed=true as operational (thực chi: cash already paid)', () => {
        const expenses = [
            { amount: 100, is_fixed: true },
            { amount: 200, is_fixed: false },
        ]
        const { dailyExpense } = splitExpenses(expenses)
        expect(dailyExpense).toBe(300)
    })

    it('skips adjustment rows (bookkeeping only)', () => {
        const expenses = [
            { amount: 0, is_refill: true, metadata: { adjustment: true, ingredient: 'coffee_g', qty: 5 } },
            { amount: 50 },
        ]
        const { dailyExpense, refillNvl } = splitExpenses(expenses)
        expect(dailyExpense).toBe(50)
        expect(refillNvl).toBe(0)
    })

    it('refillTotal = refillNvl + refillFreeForm', () => {
        const expenses = [
            { amount: 1000, is_refill: true, metadata: { ingredient: 'sugar' } },
            { amount: 50, is_refill: true, metadata: { free_form: true } },
        ]
        const { refillTotal } = splitExpenses(expenses)
        expect(refillTotal).toBe(1050)
    })

    it('handles empty / null input', () => {
        expect(splitExpenses([])).toEqual({
            dailyExpense: 0, refillNvl: 0, refillFreeForm: 0, refillTotal: 0,
        })
        expect(splitExpenses(null)).toEqual({
            dailyExpense: 0, refillNvl: 0, refillFreeForm: 0, refillTotal: 0,
        })
    })
})

describe('aggregateOrderStats discount', () => {
    const base = {
        productMap: new Map(),
        extraPriceMap: {},
        extraNameMap: {},
        recipes: [],
        extraIngredients: [],
        ingredientCosts: {},
    }

    it('sums discount_amount into totalDiscount; totalRevenue stays net', () => {
        const orders = [
            { total: 12000, discount_amount: 4000, order_items: [] },
            { total: 16000, discount_amount: 0, order_items: [] },
        ]
        const { totalRevenue, totalDiscount } = aggregateOrderStats({ orders, ...base })
        expect(totalRevenue).toBe(28000) // net (already-discounted) totals
        expect(totalDiscount).toBe(4000)
    })

    it('reads the offline-shaped discountAmount field too', () => {
        const orders = [{ total: 9000, discountAmount: 1000, cart: [] }]
        const { totalDiscount } = aggregateOrderStats({ orders, ...base })
        expect(totalDiscount).toBe(1000)
    })

    it('skips deleted orders', () => {
        const orders = [
            { total: 12000, discount_amount: 4000, deleted_at: '2026-05-31T00:00:00Z', order_items: [] },
            { total: 16000, discount_amount: 2000, order_items: [] },
        ]
        const { totalRevenue, totalDiscount } = aggregateOrderStats({ orders, ...base })
        expect(totalRevenue).toBe(16000)
        expect(totalDiscount).toBe(2000)
    })
})
