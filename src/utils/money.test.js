import { describe, it, expect } from 'vitest'
import { computeDiscount, parseVNDInput, formatVNDInput } from './money'
import { calculateItemCost } from './inventory'

describe('calculateItemCost (COGS)', () => {
    const recipes = [
        { product_id: 'p1', ingredient: 'coffee', amount: 18 },
        { product_id: 'p1', ingredient: 'cup', amount: 1 },
        { product_id: 'p2', ingredient: 'milk', amount: 100 },
    ]
    const ingredientCosts = { coffee: 200, cup: 500, milk: 30, sugar: 20 }
    const extraIngredients = { e1: [{ ingredient: 'sugar', amount: 10 }] }

    it('sums the base recipe ingredient costs', () => {
        // 18*200 + 1*500
        expect(calculateItemCost('p1', [], recipes, extraIngredients, ingredientCosts)).toBe(4100)
    })

    it('adds extra ingredient costs on top of the base recipe', () => {
        // base 4100 + sugar 10*20
        expect(calculateItemCost('p1', [{ id: 'e1' }], recipes, extraIngredients, ingredientCosts)).toBe(4300)
    })

    it('treats an ingredient with no known unit cost as 0 (no NaN)', () => {
        const recipesWithUnknown = [{ product_id: 'p3', ingredient: 'mystery', amount: 5 }]
        expect(calculateItemCost('p3', [], recipesWithUnknown, {}, ingredientCosts)).toBe(0)
    })

    it('returns 0 for a product with no recipe', () => {
        expect(calculateItemCost('does-not-exist', [], recipes, extraIngredients, ingredientCosts)).toBe(0)
    })
})

describe('computeDiscount', () => {
    it('returns no discount when value is 0 / falsy', () => {
        expect(computeDiscount(50000, { type: 'percent', value: 0 })).toEqual({ discountAmount: 0, finalTotal: 50000 })
        expect(computeDiscount(50000, { type: 'amount', value: 0 })).toEqual({ discountAmount: 0, finalTotal: 50000 })
    })

    it('applies a percentage discount with rounding', () => {
        // 10% of 45000 = 4500
        expect(computeDiscount(45000, { type: 'percent', value: 10 })).toEqual({ discountAmount: 4500, finalTotal: 40500 })
        // 33% of 10000 = 3300 (3300.0 → 3300); 15% of 33333 = 4999.95 → rounds to 5000
        expect(computeDiscount(33333, { type: 'percent', value: 15 })).toEqual({ discountAmount: 5000, finalTotal: 28333 })
    })

    it('clamps a percentage discount to 100% (never negative total)', () => {
        expect(computeDiscount(50000, { type: 'percent', value: 150 })).toEqual({ discountAmount: 50000, finalTotal: 0 })
    })

    it('applies a fixed-amount discount', () => {
        expect(computeDiscount(50000, { type: 'amount', value: 12000 })).toEqual({ discountAmount: 12000, finalTotal: 38000 })
    })

    it('clamps a fixed-amount discount to the subtotal (never negative total)', () => {
        expect(computeDiscount(30000, { type: 'amount', value: 99999 })).toEqual({ discountAmount: 30000, finalTotal: 0 })
    })
})

describe('VND input parsing/formatting round-trip', () => {
    it('parses formatted strings back to numbers', () => {
        expect(parseVNDInput('1.000.000')).toBe(1000000)
        expect(parseVNDInput('')).toBe(0)
        expect(parseVNDInput('abc')).toBe(0)
    })

    it('formats raw digit strings with thousand separators', () => {
        expect(formatVNDInput('1000000')).toBe('1.000.000')
        expect(formatVNDInput(0)).toBe('0')
        expect(formatVNDInput('')).toBe('')
    })
})
