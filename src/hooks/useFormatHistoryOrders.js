import { useMemo } from 'react'
import { dateStringVN } from '../utils/dateVN'

// Normalize today's online orders + pending offline orders into the row shape
// HistoryPage's OrdersList expects:
//   { id, total, cost, createdAt, staffName, deletedAt, deletedBy,
//     isOffline, paymentMethod, items: [{ text, cost, quantity, productId }] }
//
// `getItemCost(productId, extras, snapshotUnitCost) → number` should be the
// stable callback from HistoryPage (uses recipes + extraIngredients + costs).
// Offline orders are filtered to today's VN date and only included when
// isTodayScope is true (they don't apply to historical ranges).
// Result is sorted newest-first.
export function useFormatHistoryOrders({ baseOrders, pendingOrders, productById, getItemCost, isTodayScope }) {
    // Per-item cost computed once and reused for the order-total fallback.
    const formattedOnline = useMemo(() => baseOrders.map(o => {
        const items = o.order_items ? o.order_items.map(i => {
            const options = i.options
                ? i.options.split(', ').filter(opt => opt !== 'Tiền mặt' && opt !== 'MoMo').join(' - ')
                : ''
            const pName = productById.get(i.product_id)?.name || i.products?.name || '☕'
            const unitCost = getItemCost(i.product_id, i.extras || [], i.unit_cost || 0)
            return {
                text: `${i.quantity} ${pName}${options ? ` (${options})` : ''}`,
                cost: unitCost * i.quantity,
                quantity: i.quantity,
                productId: i.product_id
            }
        }) : []
        const cost = (o.total_cost > 0)
            ? o.total_cost
            : items.reduce((sum, item) => sum + item.cost, 0)
        return {
            id: o.id,
            total: o.total,
            cost,
            createdAt: o.created_at,
            staffName: o.staff_name,
            deletedAt: o.deleted_at,
            deletedBy: o.deleted_by,
            isOffline: false,
            paymentMethod: o.payment_method || null,
            items,
        }
    }), [baseOrders, productById, getItemCost])

    const formattedOffline = useMemo(() => {
        const todayStr = dateStringVN()
        return pendingOrders
            .filter(o => dateStringVN(new Date(o.createdAt)) === todayStr)
            .map((o) => {
                const items = o.cart
                    ? o.cart.map(i => {
                        const extras = i.extras.filter(e => e.name !== 'Tiền mặt' && e.name !== 'MoMo')
                        const unitCost = getItemCost(i.productId, i.extras, i.unitCost || 0)
                        return {
                            text: `${i.quantity} ${i.name}${extras.length ? ` (${extras.map(e => e.name).join(' - ')})` : ''}`,
                            cost: unitCost * i.quantity,
                            quantity: i.quantity,
                            productId: i.productId
                        }
                    })
                    : o.orderItems ? o.orderItems.map(i => {
                        const unitCost = getItemCost(i.productId, i.extras, i.unitCost || 0)
                        return { text: `${i.quantity} ${i.name}`, cost: unitCost * i.quantity, quantity: i.quantity, productId: i.productId }
                    }) : []
                const cost = o.totalCost > 0
                    ? o.totalCost
                    : items.reduce((sum, item) => sum + item.cost, 0)
                return {
                    id: `offline-${o.createdAt}`,
                    createdAt_key: o.createdAt,
                    total: o.total,
                    cost,
                    createdAt: o.createdAt,
                    staffName: o.staffName,
                    isOffline: true,
                    paymentMethod: o.paymentMethod || null,
                    items,
                }
            })
    }, [pendingOrders, getItemCost])

    // Hide offline pending orders when viewing a non-today range (they only exist for today).
    const allOrders = useMemo(
        () => [...formattedOnline, ...(isTodayScope ? formattedOffline : [])]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        [formattedOnline, formattedOffline, isTodayScope]
    )

    return { formattedOnline, formattedOffline, allOrders }
}
