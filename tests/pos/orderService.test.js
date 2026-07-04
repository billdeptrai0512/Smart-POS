// POS — bulkSubmitOrders: flush đơn offline ở guest mode.
// Nguồn: src/services/orderService.js

import { describe, it, expect, beforeEach } from 'vitest'
import * as repo from '../../src/services/localRepository'
import { bulkSubmitOrders } from '../../src/services/orderService'

// vitest `node` env has no localStorage; install an in-memory shim per test.
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
}

const ADDR = 'addr-1'

beforeEach(() => { installLocalStorage(); repo.setIsGuest(true) })

describe('bulkSubmitOrders (guest offline flush)', () => {
    it('maps the offline-queue shape so fetchLocalOrders can read the synced orders', async () => {
        // Shape produced by addPendingOrder (camelCase, with enriched cart items).
        const pending = [{
            orderItems: [{ productId: 'p1', quantity: 2, unitCost: 6000, extras: [{ id: 'e1', name: 'Đường' }] }],
            total: 50000,
            totalCost: 12000,
            discountAmount: 0,
            paymentMethod: 'cash',
            addressId: ADDR,
            staffName: 'Khách',
            createdAt: new Date().toISOString(),
        }]

        await bulkSubmitOrders(pending)

        // Regression guard for the dual-path drift bug: before the fix these orders were
        // stored with camelCase keys and filtered out by fetchLocalOrders (→ vanished).
        const orders = repo.fetchLocalOrders(ADDR)
        expect(orders).toHaveLength(1)
        const o = orders[0]
        expect(o.total).toBe(50000)
        expect(o.total_cost).toBe(12000)
        expect(o.order_items).toHaveLength(1)
        expect(o.order_items[0].product_id).toBe('p1')
        expect(o.order_items[0].quantity).toBe(2)
        expect(o.order_items[0].options).toBe('Đường')
        expect(o.order_items[0].unit_cost).toBe(6000)
    })
})
