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

// Dòng tiền tiền-mặt phân theo mốc "chốt ca tiền thực thu" (cash_closed_at).
//
// Bối cảnh: actual_cash là tiền mặt ĐẾM ĐƯỢC tại thời điểm chốt. Mọi khoản chi tiền
// mặt rút từ két TRƯỚC khi chốt đã làm hụt số đếm được → phải cộng lại để dựng lại
// doanh thu tiền mặt (Thực thu). Khoản chi SAU khi chốt là lấy tiền đã đếm ra tiêu →
// trừ vào Thực nhận (tiền mang về). cash_closed_at == null ⇒ chưa chốt ⇒ mọi khoản
// coi như "trước chốt" (mặc định là chi trong ca).
//
// Chuyển khoản không động đến két: actual_transfer là doanh thu CK gộp (chưa trừ NCC)
// nên CK luôn trừ ở Thực nhận, không bao giờ cộng vào Thực thu — không áp logic phase.
//
// Inputs:
//   liveCash / liveTransfer : số tiền mặt / CK đang dùng để tính (đếm được hoặc đang gõ)
//   payments       : expense_payments của ngày (NVL/refill + trả nợ + free_form sau ca)
//   shiftExpenses  : expenses non-refill của ngày ("chi trong ca" ad-hoc, không có payment riêng)
//   cashClosedAt   : ISO string mốc chốt tiền, hoặc null/undefined nếu chưa chốt
export function computeCashFlowTotals({
    liveCash = 0,
    liveTransfer = 0,
    payments = [],
    shiftExpenses = [],
    cashClosedAt = null,
}) {
    const closeMs = cashClosedAt ? new Date(cashClosedAt).getTime() : null
    // Trước chốt khi: chưa có mốc, hoặc thời điểm chi < mốc. Thiếu timestamp → coi trước chốt.
    const isBeforeClose = (ts) => {
        if (closeMs == null) return true
        if (!ts) return true
        return new Date(ts).getTime() < closeMs
    }

    let inShiftRefillCash = 0  // NVL/đi chợ trả tiền mặt TRƯỚC chốt
    let inShiftOpsCash = 0     // chi phí "trong ca" (non-refill) TRƯỚC chốt
    let postCloseCashOut = 0   // mọi khoản tiền mặt lấy ra SAU chốt (trừ Thực nhận)
    let transferRefill = 0     // CK trả NCC (luôn trừ Thực nhận CK)

    for (const p of payments || []) {
        if (p.invoice_metadata?.adjustment) continue
        const amt = Number(p.amount) || 0
        if (p.payment_method === 'transfer') { transferRefill += amt; continue }
        if (isBeforeClose(p.paid_at)) inShiftRefillCash += amt
        else postCloseCashOut += amt
    }
    // Chi phí non-refill ("chi trong ca") không có payment riêng → dùng amount + created_at.
    // Coi như tiền mặt từ két (đại đa số là vậy); phase theo thời điểm tạo.
    for (const e of shiftExpenses || []) {
        if (e.metadata?.adjustment) continue
        const amt = Number(e.amount) || 0
        if (isBeforeClose(e.created_at)) inShiftOpsCash += amt
        else postCloseCashOut += amt
    }

    const inShiftCashOut = inShiftRefillCash + inShiftOpsCash
    const actualTotal = liveCash + liveTransfer + inShiftCashOut
    const takeHomeCash = Math.max(0, liveCash - postCloseCashOut)
    const takeHomeTransfer = Math.max(0, liveTransfer - transferRefill)
    return {
        actualTotal,
        takeHomeCash,
        takeHomeTransfer,
        takeHome: takeHomeCash + takeHomeTransfer,
        inShiftCashOut,
        inShiftRefillCash,
        inShiftOpsCash,
        postCloseCashOut,
        transferRefill,
    }
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
