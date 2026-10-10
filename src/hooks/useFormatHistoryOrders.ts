import { useMemo } from 'react'
import { dateStringVN } from '../utils/dateVN'
import type { Row } from '../types/domain'

export interface HistoryOrderItem {
    id?: string; text: string; cost: number; quantity: number; productId: string
    extraIds: string[]; toppingIds?: string[]; discountAmount?: number; note: string | null
}

/** Hàng của OrdersList: đơn online (từ DB) lẫn đơn offline chờ đồng bộ. */
export interface HistoryOrder {
    id: string; orderNo?: number | null; printCount?: number; total: number; discountAmount?: number; cost: number
    createdAt: string; createdAt_key?: string; staffName?: string | null; tableName: string | null
    deletedAt?: string | null; deletedBy?: string | null; isOffline: boolean; paymentMethod: string | null
    items: HistoryOrderItem[]
}

interface RawItem { label: string; cost: number; quantity: number; productId: string; extraIds: string[]; toppingIds?: string[]; note?: string | null }

// Gom các dòng cùng tên+option lại: "1 Trà Đá" x3 → "3 Trà Đá".
// rawItems: [{ label, quantity, cost, productId, extraIds }] (label = tên + option, chưa có số lượng)
function groupItems(rawItems: RawItem[]) {
    const byLabel = new Map<string, RawItem>()
    for (const it of rawItems) {
        // Khác ghi chú = khác dòng (bếp làm khác nhau), không gộp chung.
        const key = it.note ? `${it.label} — ${it.note}` : it.label
        const prev = byLabel.get(key)
        if (prev) {
            prev.quantity += it.quantity
            prev.cost += it.cost
        } else {
            byLabel.set(key, { ...it })
        }
    }
    return [...byLabel.values()].map(i => ({
        text: `${i.quantity} ${i.label}`,
        cost: i.cost,
        quantity: i.quantity,
        productId: i.productId,
        extraIds: i.extraIds,
        toppingIds: i.toppingIds,
        note: i.note || null,
    }))
}

// Normalize today's online orders + pending offline orders into the row shape
// HistoryPage's OrdersList expects:
//   { id, total, cost, createdAt, staffName, deletedAt, deletedBy,
//     isOffline, paymentMethod, items: [{ text, cost, quantity, productId, extraIds, note }] }
// extraIds đi kèm mỗi dòng (không chỉ nằm trong label) — bill in đơn mang đi lẻ
// (OrdersList) cần nó để tính lại Đơn giá/topping từ giá menu ĐANG hiệu lực, giống
// priceLines() ở TableDetailModal.
//
// `getItemCost(productId, extras, snapshotUnitCost) → number` should be the
// stable callback from HistoryPage (uses recipes + extraIngredients + costs).
// Offline orders are filtered to today's VN date and only included when
// isTodayScope is true (they don't apply to historical ranges).
// Result is sorted newest-first.
export function useFormatHistoryOrders({ baseOrders, pendingOrders, productById, getItemCost, isTodayScope }: {
    baseOrders: Row[]; pendingOrders: Row[]; productById: Map<string, Row>
    getItemCost: (productId: string, extras: Row[], snapshotUnitCost: number) => number; isTodayScope: boolean
}) {
    // Per-item cost computed once and reused for the order-total fallback.
    // Không gộp theo tên món (khác formattedOffline bên dưới) — sửa giảm giá theo dòng
    // (OrdersList) cần bám đúng dòng order_items thật (id + discount_amount); gộp lại
    // thì 1 món gọi 2 lần khác giảm giá sẽ không còn phân biệt được nữa.
    const formattedOnline = useMemo(() => baseOrders.map((o: Row): HistoryOrder => {
        const items = (o.order_items || []).map((i: Row) => {
            const options = i.options
                ? i.options.split(', ').filter((opt: string) => opt !== 'Tiền mặt' && opt !== 'MoMo').join(' - ')
                : ''
            const pName = productById.get(i.product_id)?.name || i.products?.name || '☕'
            const unitCost = getItemCost(i.product_id, i.extras || [], i.unit_cost || 0)
            return {
                id: i.id,
                text: `${i.quantity} ${pName}${options ? ` (${options})` : ''}`,
                cost: unitCost * i.quantity,
                quantity: i.quantity,
                productId: i.product_id,
                extraIds: i.extra_ids || [],
                toppingIds: i.topping_ids || [],
                discountAmount: i.discount_amount || 0,
                note: i.note || null,
            }
        })
        const cost = (o.total_cost > 0)
            ? o.total_cost
            : items.reduce((sum: number, item: { cost: number }) => sum + item.cost, 0)
        return {
            id: o.id,
            orderNo: o.order_no ?? null,
            printCount: o.print_count || 0,
            total: o.total,
            discountAmount: o.discount_amount || 0,
            cost,
            createdAt: o.created_at,
            staffName: o.staff_name,
            tableName: o.table_name || null,
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
            .filter((o: Row) => dateStringVN(new Date(o.createdAt)) === todayStr)
            .map((o: Row): HistoryOrder => {
                const items = o.cart
                    ? groupItems(o.cart.map((i: Row) => {
                        const extras: Row[] = i.extras.filter((e: Row) => e.name !== 'Tiền mặt' && e.name !== 'MoMo')
                        const unitCost = getItemCost(i.productId, i.extras, i.unitCost || 0)
                        return {
                            label: `${i.name}${extras.length ? ` (${extras.map((e: Row) => e.name).join(' - ')})` : ''}`,
                            cost: unitCost * i.quantity,
                            quantity: i.quantity,
                            productId: i.productId,
                            extraIds: extras.map((e: Row) => e.id).filter(Boolean),
                            toppingIds: (i.toppings || []).map((t: Row) => t.id).filter(Boolean),
                        }
                    }))
                    : o.orderItems ? groupItems(o.orderItems.map((i: Row) => {
                        const unitCost = getItemCost(i.productId, i.extras, i.unitCost || 0)
                        return {
                            label: `${i.name}`,
                            cost: unitCost * i.quantity,
                            quantity: i.quantity,
                            productId: i.productId,
                            extraIds: (i.extras || []).map((e: Row) => e.id).filter(Boolean),
                            toppingIds: i.toppingIds || (i.toppings || []).map((t: Row) => t.id).filter(Boolean),
                            note: i.note || null,
                        }
                    })) : []
                const cost = o.totalCost > 0
                    ? o.totalCost
                    : items.reduce((sum: number, item: { cost: number }) => sum + item.cost, 0)
                return {
                    id: `offline-${o.createdAt}`,
                    createdAt_key: o.createdAt,
                    total: o.total,
                    cost,
                    createdAt: o.createdAt,
                    staffName: o.staffName,
                    tableName: o.tableName || null,
                    isOffline: true,
                    paymentMethod: o.paymentMethod || null,
                    items,
                }
            })
    }, [pendingOrders, getItemCost])

    // Hide offline pending orders when viewing a non-today range (they only exist for today).
    const allOrders = useMemo(
        () => [...formattedOnline, ...(isTodayScope ? formattedOffline : [])]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        [formattedOnline, formattedOffline, isTodayScope]
    )

    return { formattedOnline, formattedOffline, allOrders }
}
