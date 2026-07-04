// Báo cáo — contract: fetcher guest ↔ Supabase phải cùng shape dữ liệu.
// Nguồn: src/services/reportService.js (mock cache + supabaseClient)

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mutable container the mocked Supabase RPC reads from (vi.mock is hoisted, so the
// factory may only touch vi.hoisted state).
const h = vi.hoisted(() => ({ rpcData: { current: {} } }))

// Make the report cache a pass-through so every call actually executes its branch
// (no stale cache bleeding across cases).
vi.mock('../../src/services/cache', () => {
    const passthrough = { through: (_key, fn) => fn() }
    return { reportCache: passthrough, historicalCache: passthrough, invalidateReportCache: () => {} }
})

// Mock the Supabase client. rpc() returns the documented RPC contract; from()...single()
// returns null so attachCashClosedAt is a no-op.
vi.mock('../../src/lib/supabaseClient', () => {
    const qb = {
        select: () => qb, eq: () => qb, gte: () => qb, lte: () => qb, lt: () => qb,
        order: () => qb, limit: () => qb,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
    }
    return {
        supabase: {
            rpc: async () => ({ data: h.rpcData.current, error: null }),
            from: () => qb,
        },
    }
})

import * as repo from '../../src/services/localRepository'
import { fetchDailyReportContext, fetchReportByDate, fetchReportByRange } from '../../src/services/reportService'

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

beforeEach(() => { installLocalStorage() })

// The contract = the exact set of top-level keys each report fetcher must expose,
// derived from what the report UI (useDailyReportData) reads. The guest path must
// provide AT LEAST these keys (extra keys are fine); the Supabase path is fed a
// payload with these keys and must pass them through unchanged.
const CONTRACTS = {
    today: {
        fn: (addr) => fetchDailyReportContext(addr),
        keys: ['shift_closing', 'yesterday_closing', 'yesterday_orders', 'yesterday_expenses', 'target_payments'],
    },
    byDate: {
        fn: (addr) => fetchReportByDate(addr, '2026-06-01'),
        keys: ['shift_closing', 'yesterday_closing', 'yesterday_orders', 'yesterday_expenses', 'target_orders', 'target_expenses', 'target_payments'],
    },
    range: {
        fn: (addr) => fetchReportByRange(addr, '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '2026-05-31T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
        keys: ['target_orders', 'target_expenses', 'target_payments', 'target_shift_closings', 'prev_shift_closings', 'prev_orders', 'prev_expenses'],
    },
}

// Build a fake RPC payload that has exactly the contract keys (so the Supabase
// branch returns them) plus shift_closing:null so attachCashClosedAt is inert.
function contractPayload(keys) {
    const obj = {}
    for (const k of keys) obj[k] = k === 'shift_closing' ? null : []
    return obj
}

describe('report fetchers: guest ↔ Supabase shape contract', () => {
    for (const [name, { fn, keys }] of Object.entries(CONTRACTS)) {
        it(`${name}: guest path exposes every key the report UI reads`, async () => {
            repo.setIsGuest(true)
            const guest = await fn('addr-1')
            for (const k of keys) {
                expect(guest, `guest "${name}" missing "${k}"`).toHaveProperty(k)
            }
        })

        it(`${name}: Supabase path passes the same keys through`, async () => {
            repo.setIsGuest(false)
            h.rpcData.current = contractPayload(keys)
            const remote = await fn('addr-1')
            for (const k of keys) {
                expect(remote, `Supabase "${name}" missing "${k}"`).toHaveProperty(k)
            }
        })

        it(`${name}: guest is a superset of the Supabase contract`, async () => {
            repo.setIsGuest(true)
            const guestKeys = new Set(Object.keys(await fn('addr-1')))
            repo.setIsGuest(false)
            h.rpcData.current = contractPayload(keys)
            const remoteKeys = Object.keys(await fn('addr-1'))
            for (const k of remoteKeys) {
                expect(guestKeys.has(k), `guest "${name}" drifted: missing remote key "${k}"`).toBe(true)
            }
        })
    }
})
