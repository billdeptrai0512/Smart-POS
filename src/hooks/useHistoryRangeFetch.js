import { useEffect, useRef, useState } from 'react'
import { fetchExpensesByRange, fetchOrdersByRange } from '../services/orderService'

// Fetches orders + expenses for a (non-today) date range and caches by
// (addressId, rangeStart, rangeEnd). Returns the two lists + their loading flags.
// Today scope returns empty arrays — callers should fall back to todayOrders/Expenses.
// Read-only mode (viewing a closed past day) suppresses fetches.
// Shared shape behind rangeExpenses/rangeOrders below: cache-hit hydrate, else
// fetch once for this (addressId, startISO, endISO) and cache the result.
function useCachedRange(fetchFn, { addressId, rangeStart, rangeEnd, startISO, endISO, isTodayScope, isReadOnly }) {
    const [data, setData] = useState([])
    const [isLoading, setIsLoading] = useState(false)
    const cacheRef = useRef(new Map())

    // The today-scope reset and cache-hit hydrate set state synchronously on purpose
    // (the async fetch path drives the rest). Intentional, not a cascade hazard.
    useEffect(() => {
        if (!addressId || isReadOnly) return
        if (isTodayScope) { setData([]); return }
        const key = `${addressId}|${startISO}|${endISO}`
        const cached = cacheRef.current.get(key)
        if (cached) { setData(cached); return }
        setIsLoading(true)
        fetchFn(addressId, rangeStart, rangeEnd)
            .then(result => { cacheRef.current.set(key, result); setData(result) })
            .finally(() => setIsLoading(false))
        // ponytail: keyed on startISO/endISO (derived), not rangeStart/rangeEnd — the Date
        // objects get a new reference every render even on the same day, which would
        // refetch every render instead of only when the actual range changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressId, startISO, endISO, isTodayScope, isReadOnly])

    return { data, setData, isLoading, cacheRef }
}

export function useHistoryRangeFetch({ addressId, rangeStart, rangeEnd, isTodayScope, isReadOnly }) {
    const startISO = rangeStart.toISOString()
    const endISO = rangeEnd.toISOString()
    const rangeCtx = { addressId, rangeStart, rangeEnd, startISO, endISO, isTodayScope, isReadOnly }

    const { data: rangeExpenses, setData: setRangeExpenses, isLoading: isLoadingRange, cacheRef: expCache } = useCachedRange(fetchExpensesByRange, rangeCtx)
    const { data: rangeOrders, isLoading: isLoadingRangeOrders } = useCachedRange(fetchOrdersByRange, rangeCtx)

    // Optimistic patch helper for mutations (e.g. re-tag expense). Patches both
    // the visible state and the cached entry so a re-render or cache hit shows
    // the new value without a server refetch.
    const patchExpense = (id, updates) => {
        setRangeExpenses(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e))
        const key = `${addressId}|${startISO}|${endISO}`
        const cached = expCache.current.get(key)
        if (cached) expCache.current.set(key, cached.map(e => e.id === id ? { ...e, ...updates } : e))
    }

    return { rangeExpenses, rangeOrders, isLoadingRange, isLoadingRangeOrders, patchExpense }
}
