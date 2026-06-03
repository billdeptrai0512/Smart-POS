import { describe, it, expect, beforeEach } from 'vitest'
import * as repo from './localRepository'

// vitest runs in the `node` environment (no DOM), so localRepository's direct
// `localStorage` access would throw. Install a fresh in-memory shim per test.
function installLocalStorage() {
    const store = new Map()
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)) },
        removeItem: (k) => { store.delete(k) },
        clear: () => { store.clear() },
        key: (i) => Array.from(store.keys())[i] ?? null,
        get length() { return store.size },
    }
    return store
}

const ADDR = 'addr-1'

beforeEach(() => { installLocalStorage() })

// Seed one row in each of the 4 stores renameLocalIngredient touches.
function seedIngredient(addressId, key, { unitCost = 100, qty = 3 } = {}) {
    repo.upsertLocalIngredientCost({ ingredient: key, unit_cost: unitCost, address_id: addressId, unit: 'g' })
    repo.upsertLocalRecipe({ product_id: 'p1', ingredient: key, address_id: addressId, amount: 5 })
    repo.upsertLocalShiftClosing({ address_id: addressId, inventory_report: [{ ingredient: key, remaining: 10, restock: 2 }] })
    repo.insertLocalExpense({ address_id: addressId, is_refill: true, amount: unitCost * qty, metadata: { ingredient: key, qty } })
}

describe('renameLocalIngredient (guest sync_ingredient_key parity)', () => {
    it('renames across all 4 stores when newKey does not exist', () => {
        seedIngredient(ADDR, 'old')

        const res = repo.renameLocalIngredient(ADDR, 'old', 'new')

        expect(res.costs_action).toBe('renamed')
        expect(res.recipes_updated).toBe(1)
        expect(res.closings_updated).toBe(1)
        expect(res.expenses_updated).toBe(1)

        // 1. ingredient_costs: old gone, new keeps the unit_cost
        const costs = repo.fetchLocalIngredientCosts(ADDR)
        expect(costs.find(c => c.ingredient === 'old')).toBeUndefined()
        expect(costs.find(c => c.ingredient === 'new')?.unit_cost).toBe(100)

        // 2. recipes
        expect(repo.fetchLocalRecipes(ADDR)[0].ingredient).toBe('new')

        // 3. shift_closings.inventory_report
        const closing = repo.fetchAllLocalShiftClosings(ADDR)[0]
        expect(closing.inventory_report[0].ingredient).toBe('new')

        // 4. expenses.metadata
        expect(repo.fetchAllLocalExpenses(ADDR)[0].metadata.ingredient).toBe('new')
    })

    it('merges (drops old cost row, keeps newKey canonical) when newKey already exists', () => {
        seedIngredient(ADDR, 'old', { unitCost: 100 })
        repo.upsertLocalIngredientCost({ ingredient: 'new', unit_cost: 200, address_id: ADDR, unit: 'g' })

        const res = repo.renameLocalIngredient(ADDR, 'old', 'new')

        expect(res.costs_action).toBe('merged')
        const costs = repo.fetchLocalIngredientCosts(ADDR).filter(c => c.ingredient === 'new')
        expect(costs).toHaveLength(1)
        expect(costs[0].unit_cost).toBe(200) // canonical newKey cost preserved
        expect(repo.fetchLocalIngredientCosts(ADDR).find(c => c.ingredient === 'old')).toBeUndefined()
        // recipes still re-pointed to newKey even in merge mode
        expect(repo.fetchLocalRecipes(ADDR)[0].ingredient).toBe('new')
    })

    it('is a noop when oldKey === newKey', () => {
        seedIngredient(ADDR, 'old')
        const res = repo.renameLocalIngredient(ADDR, 'old', 'old')
        expect(res).toEqual({ recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'noop' })
        expect(repo.fetchLocalIngredientCosts(ADDR).find(c => c.ingredient === 'old')).toBeDefined()
    })

    it('returns "none" when a key is empty', () => {
        const res = repo.renameLocalIngredient(ADDR, '', 'new')
        expect(res.costs_action).toBe('none')
    })

    it('does not touch other addresses', () => {
        seedIngredient(ADDR, 'old')
        seedIngredient('addr-2', 'old')

        repo.renameLocalIngredient(ADDR, 'old', 'new')

        // addr-2 still has the old key untouched
        expect(repo.fetchLocalIngredientCosts('addr-2').find(c => c.ingredient === 'old')).toBeDefined()
        expect(repo.fetchLocalRecipes('addr-2')[0].ingredient).toBe('old')
    })
})

describe('clearGuestData', () => {
    it('clears KEYS and the out-of-KEYS ingredient sort order', () => {
        repo.upsertLocalIngredientCost({ ingredient: 'x', unit_cost: 1, address_id: ADDR })
        repo.setGuestIngredientSortOrder(['x', 'y'])
        repo.setIsGuest(true)

        repo.clearGuestData()

        expect(repo.fetchLocalIngredientCosts(ADDR)).toHaveLength(0)
        expect(repo.getGuestIngredientSortOrder()).toBeNull()
        expect(repo.isGuest()).toBe(false)
    })
})

describe('guest order / expense round-trips (shape sanity)', () => {
    it('submitLocalOrder is retrievable today with order_items', () => {
        const saved = repo.submitLocalOrder({
            address_id: ADDR, total: 50000, total_cost: 12000,
            order_items: [{ product_id: 'p1', quantity: 2, unit_cost: 6000 }],
        })
        expect(saved.id).toBeTruthy()

        const today = repo.fetchLocalOrders(ADDR)
        expect(today).toHaveLength(1)
        expect(today[0].order_items).toHaveLength(1)
        expect(today[0].total).toBe(50000)
    })

    it('insertLocalExpense fills default discount/extra columns', () => {
        const e = repo.insertLocalExpense({ address_id: ADDR, name: 'Test', amount: 1000, is_refill: false })
        expect(e.discount_amount).toBe(0)
        expect(e.extra_cost).toBe(0)
        expect(e.created_at).toBeTruthy()
    })

    it('seeds default expense categories on first fetch', () => {
        const cats = repo.fetchLocalExpenseCategories(ADDR)
        expect(cats.length).toBeGreaterThan(0)
        expect(cats.every(c => c.address_id === ADDR && c.is_active)).toBe(true)
    })

    it('deleteLocalProduct soft-deletes (drops from fetchLocalProducts)', () => {
        const p = repo.insertLocalProduct({ name: 'Cà phê', price: 25000, owner_address_id: ADDR })
        expect(repo.fetchLocalProducts(ADDR).find(x => x.id === p.id)).toBeDefined()

        repo.deleteLocalProduct(p.id)
        expect(repo.fetchLocalProducts(ADDR).find(x => x.id === p.id)).toBeUndefined()
    })
})
