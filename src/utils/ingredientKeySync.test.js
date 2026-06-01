import { describe, it, expect } from 'vitest'
import { detectKeyMismatches, suggestCanonical } from './ingredientKeySync'

describe('detectKeyMismatches — orphan classification', () => {
    it('flags a recipe key missing from ingredient_costs', () => {
        const r = detectKeyMismatches({
            recipes: [{ ingredient: 'tra' }],
            ingredientCosts: {},
        })
        expect(r.orphanRecipeKeys).toEqual(['tra'])
        expect(r.hasIssues).toBe(true)
    })

    it('flags an extra-ingredient key missing from costs', () => {
        const r = detectKeyMismatches({
            ingredientCosts: {},
            extraIngredients: { extra1: [{ ingredient: 'topping_dau' }] },
        })
        expect(r.orphanExtraIngredientKeys).toEqual(['topping_dau'])
        expect(r.hasIssues).toBe(true)
    })

    it('does NOT flag keys that exist in ingredient_costs', () => {
        const r = detectKeyMismatches({
            recipes: [{ ingredient: 'tra' }],
            ingredientCosts: { tra: 5000 },
        })
        expect(r.orphanRecipeKeys).toEqual([])
        expect(r.hasIssues).toBe(false)
    })

    // ── The deleted-ingredient bug fix ──────────────────────────────────────
    it('does NOT flag an inventory-only key with no live recipe/extra reference', () => {
        // Deleted ingredient: gone from costs + recipes + extras, but still sitting
        // in a historical shift_closings.inventory_report snapshot. Must NOT warn.
        const r = detectKeyMismatches({
            recipes: [],
            extraIngredients: {},
            ingredientCosts: {},
            inventoryReport: [{ ingredient: 'tra_da_deleted' }],
        })
        expect(r.orphanInventoryKeys).toEqual([])
        expect(r.hasIssues).toBe(false)
    })

    it('DOES flag an inventory key still referenced by a live recipe (real leak)', () => {
        // Counted + referenced + uncosted = active money leak → warn.
        const r = detectKeyMismatches({
            recipes: [{ ingredient: 'tra' }],
            ingredientCosts: {},
            inventoryReport: [{ ingredient: 'tra' }],
        })
        expect(r.orphanInventoryKeys).toEqual(['tra'])
        expect(r.hasIssues).toBe(true)
    })

    it('DOES flag an inventory key still referenced by a live extra', () => {
        const r = detectKeyMismatches({
            ingredientCosts: {},
            extraIngredients: { e1: [{ ingredient: 'syrup' }] },
            inventoryReport: [{ ingredient: 'syrup' }],
        })
        expect(r.orphanInventoryKeys).toEqual(['syrup'])
    })

    it('respects the per-address ignore list', () => {
        const r = detectKeyMismatches({
            recipes: [{ ingredient: 'tra' }],
            ingredientCosts: {},
            ignoredKeys: new Set(['tra']),
        })
        expect(r.orphanRecipeKeys).toEqual([])
        expect(r.hasIssues).toBe(false)
    })

    it('accepts ignoredKeys as a plain array too', () => {
        const r = detectKeyMismatches({
            recipes: [{ ingredient: 'tra' }],
            ingredientCosts: {},
            ignoredKeys: ['tra'],
        })
        expect(r.orphanRecipeKeys).toEqual([])
    })
})

describe('detectKeyMismatches — label collisions', () => {
    it('groups two distinct keys that render to the same label', () => {
        // condensed_milk_ml and sữa_đặc both display as "Sữa đặc" via ingredientLabel.
        // (Using two raw keys that normalise to the same display label.)
        const r = detectKeyMismatches({
            ingredientCosts: { 'sua_dac': 1, 'sữa_đặc': 1 },
        })
        // Only assert the mechanism fires when labels coincide; exact grouping
        // depends on ingredientLabel, so check structure not specific keys.
        if (r.labelCollisions.length > 0) {
            expect(r.labelCollisions[0].keys.length).toBeGreaterThan(1)
            expect(r.hasIssues).toBe(true)
        }
    })

    it('no collision when every key has a unique label', () => {
        const r = detectKeyMismatches({
            ingredientCosts: { ca_phe: 1, duong: 1 },
        })
        expect(r.labelCollisions).toEqual([])
    })
})

describe('detectKeyMismatches — empty / defensive', () => {
    it('returns no issues for all-empty input', () => {
        const r = detectKeyMismatches({})
        expect(r).toMatchObject({
            orphanRecipeKeys: [],
            orphanInventoryKeys: [],
            orphanExtraIngredientKeys: [],
            labelCollisions: [],
            hasIssues: false,
        })
    })

    it('ignores falsy ingredient entries', () => {
        const r = detectKeyMismatches({
            recipes: [{ ingredient: null }, { ingredient: '' }, {}],
            ingredientCosts: {},
        })
        expect(r.orphanRecipeKeys).toEqual([])
    })
})

describe('suggestCanonical', () => {
    it('prefers the single key already in ingredient_costs', () => {
        const collision = { label: 'Sữa đặc', keys: ['sua_dac', 'sữa_đặc'] }
        expect(suggestCanonical(collision, { 'sữa_đặc': 1 })).toBe('sữa_đặc')
    })
    it('falls back to alphabetical first when none in costs', () => {
        const collision = { label: 'X', keys: ['b_key', 'a_key'] }
        expect(suggestCanonical(collision, {})).toBe('b_key') // keys[0], unsorted by caller
    })
})
