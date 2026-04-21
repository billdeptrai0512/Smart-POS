import { useEffect, useRef, useCallback } from 'react'
import { bulkSubmitOrders } from '../services/orderService'
import { supabase } from '../lib/supabaseClient'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidOrder(order) {
    if (!Array.isArray(order.orderItems) || order.orderItems.length === 0) return false
    return order.orderItems.every(item => UUID_RE.test(item.productId))
}

const PENDING_ORDERS_KEY = 'coffee_pending_orders'

export function getPendingOrders() {
    try {
        const raw = localStorage.getItem(PENDING_ORDERS_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function savePendingOrders(orders) {
    localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(orders))
}

export function removePendingOrder(createdAt) {
    const pending = getPendingOrders()
    savePendingOrders(pending.filter(o => o.createdAt !== createdAt))
}

export function addPendingOrder(orderItems, total, paymentMethod = null, addressId = null, totalCost = 0) {
    const pending = getPendingOrders()
    pending.push({
        orderItems,
        total,
        totalCost,
        paymentMethod,
        addressId,
        createdAt: new Date().toISOString(),
    })
    savePendingOrders(pending)
}

export function useOfflineSync(onSyncComplete) {
    const isSyncing = useRef(false)

    const syncPending = useCallback(async () => {
        if (isSyncing.current || !supabase) return
        const allPending = getPendingOrders()
        if (allPending.length === 0) return

        // Discard orders with invalid (non-UUID) product IDs from pre-migration data
        const pending = allPending.filter(o => {
            if (!isValidOrder(o)) {
                console.warn('Discarding invalid pending order (non-UUID productId):', o)
                return false
            }
            return true
        })
        if (pending.length < allPending.length) savePendingOrders(pending)
        if (pending.length === 0) return

        isSyncing.current = true
        const failed = []

        try {
            // Bulk exact orders. If this entire batch fails, it's pushed to failed stack.
            // Supabase RPC does all in one Postgres transaction
            await bulkSubmitOrders(pending)
        } catch (err) {
            console.error('Bulk sync failed for orders:', err)
            // Rollback entire array to local cache if sync fails
            failed.push(...pending)
        }

        savePendingOrders(failed)
        isSyncing.current = false

        if (failed.length < pending.length && onSyncComplete) {
            onSyncComplete()
        }
    }, [onSyncComplete])

    useEffect(() => {
        // Try syncing on mount
        syncPending()

        // Sync when coming back online
        const handleOnline = () => {
            syncPending()
        }

        window.addEventListener('online', handleOnline)
        return () => window.removeEventListener('online', handleOnline)
    }, [syncPending])

    return { syncPending, getPendingCount: () => getPendingOrders().length, retrySync: syncPending }
}
