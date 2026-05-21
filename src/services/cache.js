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

export function createCache(ttlMs) {
    // Map<string, { data, t }>
    const store = new Map()

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

    // Drop a single entry. Partial keys aren't matched — use invalidatePrefix for that.
    function invalidate(parts) {
        store.delete(keyOf(parts))
    }

    // Drop every entry whose key starts with the given prefix parts.
    // Useful when a mutation invalidates a whole namespace (e.g. all
    // report reads for an addressId).
    function invalidatePrefix(parts) {
        const prefix = keyOf(parts) + '|'
        const exact = keyOf(parts)
        for (const k of store.keys()) {
            if (k === exact || k.startsWith(prefix)) store.delete(k)
        }
    }

    function clear() { store.clear() }

    // Read-through: returns cached value if fresh, else awaits fn() and caches the resolved value.
    // Rejections are NOT cached.
    async function through(parts, fn) {
        const cached = get(parts)
        if (cached !== undefined) return cached
        const data = await fn()
        set(parts, data)
        return data
    }

    return { get, set, invalidate, invalidatePrefix, clear, through }
}
