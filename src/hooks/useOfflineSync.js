import { useEffect, useRef, useCallback } from 'react'
import { bulkSubmitOrders, closeTable } from '../services/orderService'
import { supabase } from '../lib/supabaseClient'
import { STORAGE_KEYS } from '../constants/storageKeys'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidOrder(order) {
    if (!Array.isArray(order.orderItems) || order.orderItems.length === 0) return false
    return order.orderItems.every(item => UUID_RE.test(item.productId))
}

const PENDING_ORDERS_KEY = STORAGE_KEYS.PENDING_ORDERS

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

// id is fixed at creation and kept across every retry (see syncPending) so a batch
// resend after a lost response is idempotent server-side (ON CONFLICT in bulk_create_orders)
// instead of minting a new row each retry.
export function addPendingOrder(orderItems, total, paymentMethod = null, addressId = null, totalCost = 0, staffName = null, discountAmount = 0, id = null, tableName = null) {
    const pending = getPendingOrders()
    pending.push({
        id: id || crypto.randomUUID(),
        orderItems,
        total,
        totalCost,
        discountAmount,
        paymentMethod,
        addressId,
        staffName,
        tableName,
        createdAt: new Date().toISOString(),
    })
    savePendingOrders(pending)
}

// ---- Tính tiền bàn lúc mất mạng ----
// Đóng bàn là một UPDATE thẳng lên orders, mất mạng là ném lỗi — mà khách thì đang
// đứng trả tiền. Xếp hàng y như đơn offline: mốc closedAt chốt tại thời điểm thu tiền,
// đẩy lên khi có mạng lại.
const PENDING_CLOSES_KEY = STORAGE_KEYS.PENDING_TABLE_CLOSES

function getPendingTableCloses() {
    try {
        const raw = localStorage.getItem(PENDING_CLOSES_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function savePendingTableCloses(list) {
    localStorage.setItem(PENDING_CLOSES_KEY, JSON.stringify(list))
}

export function addPendingTableClose(addressId, tableName, closedAt) {
    savePendingTableCloses([...getPendingTableCloses(), { addressId, tableName, closedAt }])
}

// Hoàn tác lúc còn đang offline: rút lệnh khỏi hàng chờ trước khi nó kịp lên server.
export function removePendingTableClose(closedAt) {
    savePendingTableCloses(getPendingTableCloses().filter(c => c.closedAt !== closedAt))
}

async function flushTableCloses() {
    const pending = getPendingTableCloses()
    if (pending.length === 0) return
    const failed = []
    for (const c of pending) {
        try { await closeTable(c.addressId, c.tableName, c.closedAt) }
        catch (err) { console.error('Sync đóng bàn thất bại:', err); failed.push(c) }
    }
    savePendingTableCloses(failed)
}

export function useOfflineSync(onSyncComplete) {
    const isSyncing = useRef(false)

    const syncPending = useCallback(async () => {
        if (isSyncing.current || !supabase) return
        isSyncing.current = true
        try {
            const allPending = getPendingOrders()
            // Discard orders with invalid (non-UUID) product IDs from pre-migration data
            const pending = allPending.filter(o => {
                if (!isValidOrder(o)) {
                    console.warn('Discarding invalid pending order (non-UUID productId):', o)
                    return false
                }
                return true
            })
            if (pending.length < allPending.length) savePendingOrders(pending)

            let ordersSynced = false
            if (pending.length > 0) {
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
                ordersSynced = failed.length < pending.length
            }

            // SAU đơn: đơn offline của bàn phải nằm trong DB trước, không thì nó lọt ra
            // ngoài hoá đơn vừa đóng và bàn tự mở lại. No-op khi hàng chờ rỗng.
            await flushTableCloses()

            // Chỉ báo khi có ĐƠN lên được — onSyncComplete nạp lại doanh thu/ly bán, mà
            // đóng bàn thì không đụng hai số đó.
            if (ordersSynced && onSyncComplete) onSyncComplete()
        } finally {
            isSyncing.current = false
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
