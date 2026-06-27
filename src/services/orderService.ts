// Orders + per-day stats. Other domains live in sibling service files:
//   - productService     (products, extras, extra_ingredients)
//   - expenseService     (expenses, fixed_costs)
//   - ingredientService  (recipes, ingredient_costs, stocks, restock, key sync)
//   - reportService      (shift_closings, daily/range reports, history)
//
// Existing call sites still import everything from `services/orderService` —
// the barrel re-exports at the bottom keep that working. Prefer the focused
// imports in new code.
//
// Incremental TS: public signatures are typed against src/types/domain. Raw
// Supabase rows are still unmodeled (typed `any`) until the DB schema is generated.

import { supabase } from '../lib/supabaseClient'
// Use the namespace import directly (live binding). Do NOT alias it to a top-level
// `const` — that snapshots the binding at module-init time and, under the barrel's
// circular imports, captures `undefined` (prod crash: "reading 'isGuest' of undefined").
import * as localRepo from './localRepository'
import { startOfDayVN, dateStringVN } from '../utils/dateVN'
import { reportCache, invalidateReportCache } from './cache'
import type { UUID, CartItem, CostPerItem, OrderPayload, TodayStats } from '../types/domain'

// ---- Orders ----

// Fetch today's revenue + cups (cups excludes products with count_as_cup=false).
// Uses the get_today_stats RPC which aggregates in Postgres — payload is a
// single row, no N+1 product join over the wire. Legacy fallback below.
export async function fetchTodayStats(addressId: UUID | null): Promise<TodayStats> {
    if (localRepo.isGuest()) {
        const orders = localRepo.fetchLocalOrders(addressId)
        let revenue = 0, cups = 0
        orders.forEach((o: any) => {
            if (!o.deleted_at) revenue += Number(o.total || 0)
            const items = o.order_items || o.items || []
            items.forEach((i: any) => {
                // In local mode, we don't have the products table join easily,
                // so we assume everything is a cup unless specified in seeding.
                // For demo, this is fine.
                cups += Number(i.quantity || 0)
            })
        })
        return { revenue, cups }
    }
    if (!supabase || !addressId) return { revenue: 0, cups: 0 }

    const { data, error } = await supabase.rpc('get_today_stats', { p_address_id: addressId })
    if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        return {
            revenue: Number(row?.revenue || 0),
            cups: Number(row?.cups || 0)
        }
    }

    // Fallback: function not deployed (PGRST202 / 42883). Use legacy query.
    if (error && error.code !== 'PGRST202' && error.code !== '42883') {
        console.error('fetchTodayStats RPC error:', error)
    }

    const from = startOfDayVN()
    const { data: legacyData, error: legacyError } = await supabase
        .from('orders')
        .select('total, order_items(quantity, products(count_as_cup))')
        .eq('address_id', addressId)
        .gte('created_at', from.toISOString())

    if (legacyError) { console.error('fetchTodayStats legacy error:', legacyError); return { revenue: 0, cups: 0 } }

    let revenue = 0, cups = 0
    ;(legacyData || []).forEach((o: any) => {
        revenue += Number(o.total || 0)
        ;(o.order_items || []).forEach((i: any) => {
            if (i.products?.count_as_cup !== false) cups += Number(i.quantity || 0)
        })
    })
    return { revenue, cups }
}

// Fetch all orders for today, newest first (optionally scoped by address)
export async function fetchTodayOrders(addressId: UUID | null): Promise<any> {
    if (localRepo.isGuest()) return localRepo.fetchLocalOrders(addressId)
    if (!supabase) return []
    const today = startOfDayVN()

    let query = supabase
        .from('orders')
        .select(`
            id,
            total,
            total_cost,
            discount_amount,
            payment_method,
            created_at,
            deleted_at,
            deleted_by,
            order_items (
                quantity,
                options,
                product_id,
                unit_cost,
                extra_ids,
                products (
                    name
                )
            ),
            staff_name
        `)
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
        console.error('fetchTodayOrders error:', error)
        return []
    }
    return data
}

// Submit a complete order to Supabase using RPC for atomic transaction
// totalCost: tổng giá vốn của bill (snapshot)
// costPerItem: Map<cartItemId, unitCost> giá vốn mỗi dòng (snapshot)
export async function submitOrder(
    cart: CartItem[],
    total: number,
    paymentMethod: string | null = null,
    addressId: UUID | null = null,
    totalCost = 0,
    costPerItem: CostPerItem = {},
    staffName: string | null = null,
    discountAmount = 0
): Promise<{ id: string | null }> {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) {
        return localRepo.submitLocalOrder({
            total,
            total_cost: Math.round(totalCost),
            discount_amount: Math.round(discountAmount),
            payment_method: paymentMethod,
            address_id: addressId,
            staff_name: staffName,
            order_items: cart.map(item => ({
                product_id: item.productId,
                quantity: item.quantity,
                options: item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null,
                unit_cost: Math.round(costPerItem[item.cartItemId] || 0)
            }))
        })
    }
    if (!supabase) throw new Error('No Supabase connection')

    const orderPayload: OrderPayload = {
        total,
        total_cost: Math.round(totalCost),
        discount_amount: Math.round(discountAmount),
        payment_method: paymentMethod,
        address_id: addressId,
        staff_name: staffName,
        items: cart.map(item => {
            const optionsText = item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null
            const extraIds = item.extras?.length > 0 ? item.extras.map(e => e.id).filter(Boolean) : []
            return {
                product_id: item.productId,
                quantity: item.quantity,
                options: optionsText,
                unit_cost: Math.round(costPerItem[item.cartItemId] || 0),
                extra_ids: extraIds
            }
        })
    }

    // Call RPC function for single transaction order creation
    const { error } = await supabase.rpc('bulk_create_orders', {
        orders_payload: [orderPayload]
    })

    if (error) throw error
    return { id: null }
}

// Bulk submit offline orders in ONE HTTP Request
export async function bulkSubmitOrders(ordersArray: any[]): Promise<boolean> {
    // Mixed addresses possible — flush all to be safe.
    invalidateReportCache(null)
    if (localRepo.isGuest()) {
        // Map the offline-queue shape (camelCase: orderItems / addressId / totalCost) to the
        // localRepo row shape (order_items / address_id / total_cost), same as submitOrder does.
        // Without this, fetchLocalOrders filters on `address_id` and never sees these orders →
        // a guest's offline orders silently vanish after sync.
        ordersArray.forEach((o: any) => localRepo.submitLocalOrder({
            total: o.total,
            total_cost: o.totalCost || 0,
            discount_amount: o.discountAmount || 0,
            payment_method: o.paymentMethod,
            address_id: o.addressId,
            staff_name: o.staffName,
            created_at: o.createdAt,
            order_items: (o.orderItems || []).map((item: any) => ({
                product_id: item.productId,
                quantity: item.quantity,
                options: item.extras?.length > 0 ? item.extras.map((e: any) => e.name).join(', ') : null,
                unit_cost: Math.round(item.unitCost || 0),
            })),
        }))
        return true
    }
    if (!supabase) throw new Error('No Supabase connection')

    const payload = ordersArray.map((o: any) => ({
        total: o.total,
        total_cost: o.totalCost || 0,
        discount_amount: o.discountAmount || 0,
        payment_method: o.paymentMethod,
        address_id: o.addressId,
        created_at: o.createdAt,
        staff_name: o.staffName,
        items: o.orderItems.map((item: any) => {
            const optionsText = item.extras?.length > 0 ? item.extras.map((e: any) => e.name).join(', ') : null
            const extraIds = item.extras?.length > 0 ? item.extras.map((e: any) => e.id).filter(Boolean) : (item.extraIds || []).filter(Boolean)
            return {
                product_id: item.productId,
                quantity: item.quantity,
                options: optionsText,
                unit_cost: Math.round(item.unitCost || 0),
                extra_ids: extraIds
            }
        })
    }))

    const { error } = await supabase.rpc('bulk_create_orders', {
        orders_payload: payload
    })

    if (error) throw error
    return true
}

// Soft Delete an order. addressId unknown — flush all.
export async function deleteOrder(orderId: UUID, staffName: string | null = null): Promise<boolean> {
    invalidateReportCache(null)
    // localRepository is untyped JS; its `= null` defaults make tsc infer params as `null`.
    // Cast the fn (lazy, at call time — safe under circular imports) until it's converted.
    if (localRepo.isGuest()) return (localRepo.deleteLocalOrder as any)(orderId, staffName)
    if (!supabase) throw new Error('No Supabase connection')

    const { error: orderError } = await supabase
        .from('orders')
        .update({ deleted_at: new Date().toISOString(), deleted_by: staffName })
        .eq('id', orderId)

    if (orderError) throw orderError

    return true
}

// Re-apply / edit a per-order discount after the fact. `total` is the new charged
// amount (subtotal − discount); discount_amount stores the đ reduced. COGS (total_cost)
// is unchanged — a discount affects revenue, not cost. addressId unknown → flush all.
export async function updateOrderDiscount(orderId: UUID, total: number, discountAmount: number): Promise<boolean> {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return (localRepo.updateLocalOrderDiscount as any)(orderId, total, discountAmount)
    if (!supabase) throw new Error('No Supabase connection')

    const { error } = await supabase
        .from('orders')
        .update({ total, discount_amount: discountAmount })
        .eq('id', orderId)

    if (error) throw error

    return true
}

// Fetch all orders for yesterday (start of yesterday to start of today), scoped by address
export async function fetchYesterdayOrders(addressId: UUID | null): Promise<any> {
    if (localRepo.isGuest()) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return (localRepo.fetchLocalOrders as any)(addressId, yesterday.toISOString())
    }
    if (!supabase) return []
    const today = startOfDayVN()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let query = supabase
        .from('orders')
        .select(`
            id,
            total,
            total_cost,
            staff_name,
            deleted_at,
            order_items (
                quantity,
                product_id,
                unit_cost,
                extra_ids
            )
        `)
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query
    if (error) {
        console.error('fetchYesterdayOrders error:', error)
        return []
    }
    return data || []
}

// Fetch orders within a date range for an address (same structure as fetchTodayOrders)
export async function fetchOrdersByRange(addressId: UUID | null, start: Date, end: Date): Promise<any> {
    return reportCache.through([addressId, 'ordersByRange', start.toISOString(), end.toISOString()], async () => {
        if (localRepo.isGuest()) {
            const sMs = start.getTime(), eMs = end.getTime()
            return localRepo.fetchAllLocalOrders(addressId)
                .filter((o: any) => {
                    const t = new Date(o.created_at).getTime()
                    return t >= sMs && t <= eMs
                })
                .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        }
        if (!supabase) return []
        let query = supabase
            .from('orders')
            .select(`id, total, total_cost, payment_method, staff_name, created_at, deleted_at, deleted_by,
                order_items(quantity, options, product_id, unit_cost, extra_ids, products(name))`)
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString())
        if (addressId) query = query.eq('address_id', addressId)
        const { data, error } = await query.order('created_at', { ascending: false })
        if (error) { console.error('fetchOrdersByRange error:', error); return [] }
        return data || []
    })
}

// Fetch the most recent order today for an address (with items + product names)
export async function fetchRecentOrders(addressId: UUID | null, limit = 3): Promise<any[]> {
    if (localRepo.isGuest()) {
        const todayStr = dateStringVN()
        return localRepo.fetchAllLocalOrders(addressId)
            .filter((o: any) => !o.deleted_at && dateStringVN(new Date(o.created_at)) === todayStr)
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit)
    }
    if (!supabase) return []
    const today = startOfDayVN()

    let query = supabase
        .from('orders')
        .select(`id, total, created_at, deleted_at, deleted_by, order_items(quantity, options, product_id, products(name))`)
        .gte('created_at', today.toISOString())
        .is('deleted_at', null)

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
    if (error || !data) return []
    return data
}

// ---- Compat barrel: existing call sites import everything from this file.
// New code should prefer the focused service files directly.
export * from './productService'
export * from './expenseService'
export * from './ingredientService'
export * from './reportService'
