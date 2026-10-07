// Tiny TTL cache for service-layer reads. Designed for the case where
// the user toggles between tabs/views that refetch the same endpoint —
// 30s lets repeated reads feel instant without holding stale data long.
//
// Mutations call invalidate(...) to drop stale entries before the next read.
//
// Usage:
//   const cache = createCache(30_000)
//   export async function fetchX(addressId) {
//       return cache.through(['x', addressId], () => actuallyFetch(addressId))
//   }
//   export function invalidateX(addressId) { cache.invalidate(['x', addressId]) }

function createCache(ttlMs) {
    // Map<string, { data, t }>
    const store = new Map()
    // Map<string, Promise> — lần đọc đang bay, dùng chung cho mọi caller cùng key (StrictMode
    // chạy effect 2 lần, 2 hook mount cùng lúc…) thay vì mỗi caller 1 round-trip.
    const inflight = new Map()

    const keyOf = (parts) => parts.map(p => p == null ? '' : String(p)).join('|')

    function get(parts) {
        const k = keyOf(parts)
        const hit = store.get(k)
        if (!hit) return undefined
        if (Date.now() - hit.t >= ttlMs) {
            store.delete(k)
            return undefined
        }
        return hit.data
    }

    function set(parts, data) {
        store.set(keyOf(parts), { data, t: Date.now() })
    }

    // Drop every entry whose key starts with the given prefix parts.
    // Useful when a mutation invalidates a whole namespace (e.g. all
    // report reads for an addressId).
    function invalidatePrefix(parts) {
        const prefix = keyOf(parts) + '|'
        const exact = keyOf(parts)
        // Bỏ cả lần đọc đang bay: caller SAU invalidate (vd refetch ngay sau khi ghi) không được
        // nhập vào request khởi chạy trước lúc ghi → trả dữ liệu cũ.
        for (const m of [store, inflight]) {
            for (const k of m.keys()) {
                if (k === exact || k.startsWith(prefix)) m.delete(k)
            }
        }
    }

    function clear() { store.clear(); inflight.clear() }

    // Read-through: returns cached value if fresh, else awaits fn() and caches the resolved value.
    // Concurrent callers with the same key share one fn() call. Rejections are NOT cached.
    // Kết quả chỉ được ghi vào cache nếu lần đọc này chưa bị invalidate trong lúc bay.
    async function through(parts, fn) {
        const cached = get(parts)
        if (cached !== undefined) return cached
        const k = keyOf(parts)
        let p = inflight.get(k)
        if (!p) {
            p = fn()
                .then((data) => { if (inflight.get(k) === p) set(parts, data); return data })
                .finally(() => { if (inflight.get(k) === p) inflight.delete(k) })
            inflight.set(k, p)
        }
        return p
    }

    return { invalidatePrefix, clear, through }
}

// ─── Shared instances ────────────────────────────────────────────────────────
// reportCache (30s) backs everything users see on Report / History pages:
// reports, orders/expenses by range, fixed costs, shift closings. Any mutation
// to those tables calls invalidateReportCache(addressId) so the next read goes
// to the network.
//
// historicalCache (5 min) backs immutable past data (last week / past days).
// Yesterday's rows don't mutate, so a longer TTL is safe.
export const reportCache = createCache(30_000)
export const historicalCache = createCache(5 * 60_000)

// TTL 0 = KHÔNG giữ kết quả, chỉ cho các caller đồng thời cùng key chung 1 lần fetch. Dành cho đọc
// tồn kho: nhiều hook cùng mount (trang + dải notice + StrictMode) bắn y hệt nhau, nhưng dữ liệu
// đổi theo từng thao tác ghi nên không được giữ lại như reportCache.
export const inflightCache = createCache(0)

export function invalidateInflight(addressId) {
    if (addressId) inflightCache.invalidatePrefix([addressId])
    else inflightCache.clear()
}

export function invalidateReportCache(addressId) {
    if (addressId) reportCache.invalidatePrefix([addressId])
    else reportCache.clear()
    invalidateInflight(addressId)
}

