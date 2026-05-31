import { calculateItemCost as calculateProductCost } from './inventory'

// Builds lookup maps once so per-item math stays O(1).
export function buildExtraMaps(productExtras) {
    const priceMap = {}, nameMap = {}
    Object.values(productExtras || {}).forEach(extras => {
        extras.forEach(e => {
            priceMap[e.id] = e.price || 0
            nameMap[e.id] = e.name || e.id
        })
    })
    return { priceMap, nameMap }
}

export function buildVariantLabel(extraNames) {
    if (!extraNames?.length) return 'Thường'
    return [...extraNames]
        .sort((a, b) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), 'vi'))
        .join(' + ')
}

// Splits expenses into the P&L buckets.
// "Thực chi" model: is_fixed=true rows are LEGACY auto-injected fixed costs from
// before the model switch. They still represent actual money paid, so they're
// counted as operational expense. New entries never set is_fixed=true.
// Adjustments (metadata.adjustment=true) are inventory bookkeeping — manager
// edited the qty on file. Amount is 0 by construction, but we skip explicitly
// so a future bug that sets amount != 0 doesn't leak into cash flow / P&L.
export function splitExpenses(expenses) {
    let dailyExpense = 0, refillNvl = 0, refillFreeForm = 0
    for (const e of expenses || []) {
        if (e.metadata?.adjustment) continue
        if (e.is_refill) {
            if (e.metadata?.free_form) refillFreeForm += e.amount
            else refillNvl += e.amount
        } else {
            dailyExpense += e.amount
        }
    }
    return { dailyExpense, refillNvl, refillFreeForm, refillTotal: refillNvl + refillFreeForm }
}

// Walks orders once and returns aggregated stats shared by Daily/Range reports.
//
// Handles both shapes:
//  - online orders:  { total, total_cost?, created_at, order_items: [{ product_id, quantity, unit_cost?, extra_ids? }] }
//  - offline orders: { total, totalCost?, createdAt, cart: [{ productId, quantity, unitCost?, extras: [{ id, name, price }] }] }
//
// `useTotalCostShortcut`: when true, trusts o.total_cost (Range) and skips per-item COGS sum.
// `selectedProductId`: 'all' counts all non-excluded products into totalCups; otherwise only that product.
export function aggregateOrderStats({
    orders,
    productMap,
    extraPriceMap,
    extraNameMap,
    recipes,
    extraIngredients,
    ingredientCosts,
    selectedProductId = 'all',
    useTotalCostShortcut = false,
}) {
    let totalRevenue = 0, totalDiscount = 0, totalCOGS = 0, totalCups = 0
    const productStats = {}
    const soldProducts = new Set()
    const hourlyRevenue = {}, hourlyOrders = {}
    const activeHours = new Set()

    const isExcluded = (pid) => productMap.get(pid)?.count_as_cup === false

    for (const o of orders || []) {
        if (o.deleted_at) continue
        const orderTotal = o.total || 0
        totalRevenue += orderTotal
        totalDiscount += o.discount_amount || o.discountAmount || 0

        const createdAt = o.created_at || o.createdAt
        let hour = null
        if (createdAt) {
            hour = new Date(createdAt).getHours()
            activeHours.add(hour)
            hourlyRevenue[hour] = (hourlyRevenue[hour] || 0) + orderTotal
        }

        const hasOrderCost = useTotalCostShortcut && o.total_cost > 0
        if (hasOrderCost) totalCOGS += o.total_cost

        const items = o.order_items || o.cart || o.orderItems || []
        for (const i of items) {
            const qty = i.quantity || i.qty || 1
            const productId = i.product_id || i.productId
            const prodDef = productMap.get(productId)

            if (selectedProductId === 'all') {
                if (!isExcluded(productId)) totalCups += qty
            } else if (selectedProductId === productId) {
                totalCups += qty
            }

            soldProducts.add(productId)

            let cost = 0
            if (!hasOrderCost) {
                const snapshotCost = i.unit_cost || i.unitCost || 0
                cost = snapshotCost > 0
                    ? snapshotCost
                    : calculateProductCost(productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                totalCOGS += cost * qty
            }

            if (hour !== null) {
                const name = prodDef?.name || i.name || i.products?.name || '?'
                if (!hourlyOrders[hour]) hourlyOrders[hour] = {}
                hourlyOrders[hour][name] = (hourlyOrders[hour][name] || 0) + qty
            }

            const basePrice = prodDef?.price || 0
            const extras = i.extras || []
            const extraIds = i.extra_ids || []
            const extrasPrice = extras.length
                ? extras.reduce((s, e) => s + (e.price || 0), 0)
                : extraIds.reduce((s, id) => s + (extraPriceMap[id] || 0), 0)
            const unitRevenue = basePrice + extrasPrice

            const extraNames = extras.length
                ? extras.map(e => e.name).filter(Boolean)
                : extraIds.map(id => extraNameMap[id]).filter(Boolean)
            const variantLabel = buildVariantLabel(extraNames)

            if (!productStats[productId]) productStats[productId] = { qty: 0, revenue: 0, cost: 0, variants: {} }
            productStats[productId].qty += qty
            productStats[productId].revenue += unitRevenue * qty
            productStats[productId].cost += cost * qty
            productStats[productId].variants[variantLabel] = (productStats[productId].variants[variantLabel] || 0) + qty
        }
    }

    return { totalRevenue, totalDiscount, totalCOGS, totalCups, productStats, soldProducts, hourlyRevenue, hourlyOrders, activeHours }
}

// Builds the hourly cumulative line-chart series from aggregator output. Daily-only.
export function buildHourlyLineChart({ activeHours, hourlyRevenue, hourlyOrders }) {
    if (activeHours.size === 0) return []
    const minH = Math.min(...activeHours), maxH = Math.max(...activeHours)
    let cumulative = 0
    const out = []
    for (let h = minH; h <= maxH; h++) {
        cumulative += (hourlyRevenue[h] || 0)
        const items = Object.entries(hourlyOrders[h] || {})
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
        out.push({ hour: `${h}h`, revenue: cumulative, hourRevenue: hourlyRevenue[h] || 0, items })
    }
    return out
}
