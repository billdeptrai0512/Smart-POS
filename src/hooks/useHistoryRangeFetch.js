import { useEffect, useRef, useState } from 'react'
import { fetchExpensesByRange, fetchOrdersByRange } from '../services/orderService'

// Fetches orders + expenses for a (non-today) date range and caches by
// (addressId, rangeStart, rangeEnd). Returns the two lists + their loading flags.
// Today scope returns empty arrays — callers should fall back to todayOrders/Expenses.
// Read-only mode (viewing a closed past day) suppresses fetches.
export function useHistoryRangeFetch({ addressId, rangeStart, rangeEnd, isTodayScope, isReadOnly }) {
    const [rangeExpenses, setRangeExpenses] = useState([])
    const [rangeOrders, setRangeOrders] = useState([])
    const [isLoadingRange, setIsLoadingRange] = useState(false)
    const [isLoadingRangeOrders, setIsLoadingRangeOrders] = useState(false)
    const expCache = useRef(new Map())
    const ordCache = useRef(new Map())

    const startISO = rangeStart.toISOString()
    const endISO = rangeEnd.toISOString()

    useEffect(() => {
        if (!addressId || isReadOnly) return
        if (isTodayScope) { setRangeExpenses([]); return }
        const key = `${addressId}|${startISO}|${endISO}`
        const cached = expCache.current.get(key)
        if (cached) { setRangeExpenses(cached); return }
        setIsLoadingRange(true)
        fetchExpensesByRange(addressId, rangeStart, rangeEnd)
            .then(data => { expCache.current.set(key, data); setRangeExpenses(data) })
            .finally(() => setIsLoadingRange(false))
    }, [addressId, startISO, endISO, isTodayScope, isReadOnly])

    useEffect(() => {
        if (!addressId || isReadOnly) return
        if (isTodayScope) { setRangeOrders([]); return }
        const key = `${addressId}|${startISO}|${endISO}`
        const cached = ordCache.current.get(key)
        if (cached) { setRangeOrders(cached); return }
        setIsLoadingRangeOrders(true)
        fetchOrdersByRange(addressId, rangeStart, rangeEnd)
            .then(data => { ordCache.current.set(key, data); setRangeOrders(data) })
            .finally(() => setIsLoadingRangeOrders(false))
    }, [addressId, startISO, endISO, isTodayScope, isReadOnly])

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
