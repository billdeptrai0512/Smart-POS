import { useState, useEffect, useMemo } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost, formatVNDInput, parseVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext } from '../services/orderService'
import { useShiftClosingSave } from '../hooks/useShiftClosingSave'
import { useShiftInventoryState } from '../hooks/useShiftInventoryState'
import { useDailyReportData } from '../hooks/useDailyReportData'
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, splitCogsByCategory, calculateLossValue } from '../utils/inventory'
import { startOfDayVN, dateStringVN, isSameDayVN } from '../utils/dateVN'
import { offsetFromISO, dayCustomDateOf } from '../utils/rangeCalc'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import SalesCard from '../components/DailyReportPage/SalesCard'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import { fetchExpenseCategories } from '../services/expenseService'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'
import InventoryReportCard from '../components/ShiftClosingPage/InventoryReportCard'
import RangeLossCard from '../components/DailyReportPage/RangeLossCard'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY } from '../components/DailyReportPage/ReportViewFilter'
import HistoryFooter from '../components/HistoryPage/HistoryFooter'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useEntitlement, hasFeature } from '../hooks/useEntitlement'
import UpsellPage from '../components/common/UpsellPage'
import UpsellSheet from '../components/common/UpsellSheet'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { shiftFinalizedKey } from '../constants/storageKeys'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits, ingredientConfigs } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory } = usePOS()
    const { isStaff, profile } = useAuth()
    const { activeModules, loading: entitlementLoading } = useEntitlement()
    const { toast, showToast, showError } = useToast()

    // ── All hooks unconditional (Rules of Hooks) ──────────────────────────────
    const initialView = [VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY].includes(location.state?.initialView)
        ? location.state.initialView : VIEW_CASHFLOW
    const [view, setView] = useState(initialView)
    const [selectedProductId, setSelectedProductId] = useState('all')
    const { selectedAddress } = useAddress()
    const initialDate = location.state?.initialDate || null

    const [scope, setScope] = useState('day')
    const [offset, setOffset] = useState(0)
    const [customRange, setCustomRange] = useState(null)
    const [hasManualPick, setHasManualPick] = useState(false)
    const [showLossUpsell, setShowLossUpsell] = useState(false)

    // Seed customDate if navigated with it
    useEffect(() => {
        if (initialDate) {
            const today = dateStringVN(new Date())
            if (initialDate !== today) {
                const target = new Date(initialDate + 'T00:00:00+07:00')
                const start = startOfDayVN()
                setOffset(Math.round((target - start) / 86400000))
                setHasManualPick(true)
            }
        }
    }, [initialDate])

    // All server-data state (shift closing, yesterday comparison, range data,
    // todayISO midnight rollover) lives in useDailyReportData. setShiftClosing
    // is exposed so save handlers can patch it inline after a write.
    const {
        todayISO,
        isTodayScope,
        rangeStart, rangeEnd,
        shiftClosing, setShiftClosing,
        yesterdayClosing,
        yesterdayOrders,
        yesterdayExpensesData,
        apiOrders,
        apiExpenses,
        apiShiftClosings,
        prevShiftClosings,
        isAsyncReady,
    } = useDailyReportData({
        addressId: selectedAddress?.id,
        scope, offset, customRange,
        onError: showError,
    })

    // Inline cash/transfer editor (today scope only). Pre-fills from shiftClosing when
    // it loads; cashDirty is derived from input vs. persisted so reverting the change
    // makes the Lưu button disappear again.
    const [cashInput, setCashInput] = useState('')
    const [transferInput, setTransferInput] = useState('')
    const { save: saveShiftClosing, isSaving: isSavingShift } = useShiftClosingSave(selectedAddress?.id)

    // Inventory editor (today scope only). All input state + warehouse fetch live in
    // the hook so DailyReportPage stays focused on render orchestration. todayISO
    // drives existingClosing refetch on midnight rollover.
    const inventory = useShiftInventoryState(selectedAddress?.id, selectedAddress?.ingredient_sort_order, todayISO)
    const [inventoryTab, setInventoryTab] = useState('report') // 'report' | 'refill'

    // Expense categories — feed dynamic rows into FinanceCards. Refetched per
    // address; new tags added in /history are picked up on next mount or after
    // reportCache invalidation.
    const [expenseCategories, setExpenseCategories] = useState([])
    useEffect(() => {
        if (!selectedAddress?.id) return
        fetchExpenseCategories(selectedAddress.id).then(setExpenseCategories)
    }, [selectedAddress?.id])

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Pre-fill cash/transfer inputs from the existing shift_closing (if any).
    // Guard with closed_at === today VN: fetchDailyReportContext occasionally
    // returns yesterday's shift_closing as `shift_closing` (server tz / RPC
    // boundary issue), which would leave yesterday's cash + transfer values
    // sticky after midnight. If closed_at isn't today, treat as no row → blank.
    const isTodaysClosing = shiftClosing?.closed_at
        && dateStringVN(new Date(shiftClosing.closed_at)) === todayISO
    const persistedCash = isTodaysClosing && shiftClosing.actual_cash != null
        ? Number(shiftClosing.actual_cash) : 0
    const persistedTransfer = isTodaysClosing && shiftClosing.actual_transfer != null
        ? Number(shiftClosing.actual_transfer) : 0
    const cashDirty = (parseVNDInput(cashInput) || 0) !== persistedCash
        || (parseVNDInput(transferInput) || 0) !== persistedTransfer
    useEffect(() => {
        if (!isTodayScope) return
        setCashInput(isTodaysClosing && shiftClosing.actual_cash != null ? formatVNDInput(shiftClosing.actual_cash) : '')
        setTransferInput(isTodaysClosing && shiftClosing.actual_transfer != null ? formatVNDInput(shiftClosing.actual_transfer) : '')
    }, [isTodayScope, todayISO, shiftClosing?.id, shiftClosing?.actual_cash, shiftClosing?.actual_transfer, shiftClosing?.closed_at])

    // Pure-derived finalize flag — true iff persisted shift_closing has cash + transfer
    // entered AND every ingredient in the recipe list has Cuối kỳ (remaining) counted.
    // No localStorage source of truth, no manual "Xác nhận chốt ca" button: if staff
    // later clears a Cuối kỳ value and re-saves, the badge unsets itself.
    const isShiftFinalized = useMemo(() => {
        if (!isTodaysClosing) return false
        if (shiftClosing.actual_cash == null || shiftClosing.actual_transfer == null) return false
        const report = shiftClosing.inventory_report
        if (!Array.isArray(report) || report.length === 0) return false
        const list = inventory.ingredientsList || []
        if (list.length === 0) return false
        const remainingByIng = {}
        for (const row of report) remainingByIng[row.ingredient] = row.remaining
        return list.every(ing => remainingByIng[ing.ingredient] != null)
    }, [isTodaysClosing, shiftClosing?.actual_cash, shiftClosing?.actual_transfer, shiftClosing?.inventory_report, inventory.ingredientsList])

    // Sync the derived flag to localStorage so HistoryPage can classify subsequent
    // operational expenses as "Sau ca" without needing to refetch shift_closing.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress?.id) return
        const key = shiftFinalizedKey(selectedAddress.id, todayISO)
        if (isShiftFinalized) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, Date.now().toString())
        } else {
            localStorage.removeItem(key)
        }
    }, [isShiftFinalized, isTodayScope, selectedAddress?.id, todayISO])

    // Breakdown of what's still missing — drives the status banner so staff
    // can see exactly which boxes block finalize instead of just "not done yet".
    const finalizeMissing = useMemo(() => {
        if (!isTodayScope) return null
        const parts = []
        const report = isTodaysClosing && Array.isArray(shiftClosing?.inventory_report)
            ? shiftClosing.inventory_report : []
        const remainingByIng = {}
        for (const row of report) remainingByIng[row.ingredient] = row.remaining
        const list = inventory.ingredientsList || []
        const uncounted = list.filter(ing => remainingByIng[ing.ingredient] == null).length
        if (list.length > 0 && uncounted > 0) parts.push(`${uncounted} nguyên liệu chưa đếm`)
        if (!isTodaysClosing || shiftClosing.actual_cash == null) parts.push('chưa nhập tiền mặt')
        if (!isTodaysClosing || shiftClosing.actual_transfer == null) parts.push('chưa nhập chuyển khoản')
        return parts
    }, [isTodayScope, isTodaysClosing, shiftClosing?.actual_cash, shiftClosing?.actual_transfer, shiftClosing?.inventory_report, inventory.ingredientsList])

    // Computed display data
    const displayOrders = isTodayScope ? todayOrders : apiOrders
    const displayExpenses = isTodayScope ? todayExpenses : apiExpenses

    const dayCustomDate = useMemo(() => dayCustomDateOf(scope, offset), [scope, offset])

    const dayInputValue = dayCustomDate || todayISO
    const canGoForwardDay = dayInputValue < todayISO

    const rangeLabel = useMemo(() => {
        const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        if (scope === 'day') {
            return `${fmt(rangeStart)}/${rangeStart.getFullYear()}`
        }
        if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
            const sStr = customRange.startISO.split('-')
            const eStr = customRange.endISO.split('-')
            return `${sStr[2]}/${sStr[1]} – ${eStr[2]}/${eStr[1]}`
        }
        return `${fmt(rangeStart)} – ${fmt(rangeEnd)}`
    }, [scope, offset, rangeStart, rangeEnd, customRange])

    const setOffsetFromISO = (iso) => {
        if (!iso || iso >= todayISO) { setOffset(0); setHasManualPick(false); return }
        setOffset(offsetFromISO(iso, todayISO))
    }
    const handleManualDatePick = (iso) => { setHasManualPick(true); setOffsetFromISO(iso) }
    const handlePrevDay = () => {
        setHasManualPick(false)
        const d = new Date(); d.setDate(d.getDate() + offset - 1)
        setOffsetFromISO(dateStringVN(d))
    }
    const handleNextDay = () => {
        const d = new Date(); d.setDate(d.getDate() + offset + 1)
        if (dateStringVN(d) >= todayISO) { setOffset(0); setHasManualPick(false) }
        else { setHasManualPick(false); setOffsetFromISO(dateStringVN(d)) }
    }
    const handleDayEndPick = (endISO) => {
        if (!dayCustomDate || !endISO || endISO <= dayCustomDate) return
        const cappedEnd = endISO > todayISO ? todayISO : endISO
        setCustomRange({ startISO: dayCustomDate, endISO: cappedEnd })
        setScope('custom')
    }
    const handleCustomStartChange = (iso) => {
        if (!iso) return
        const clampedEnd = customRange?.endISO || iso
        const safeStart = iso > clampedEnd ? clampedEnd : (iso > todayISO ? todayISO : iso)
        setCustomRange({ startISO: safeStart, endISO: clampedEnd })
    }
    const handleCustomEndChange = (iso) => {
        if (!iso) return
        const start = customRange?.startISO || iso
        const safeEnd = iso > todayISO ? todayISO : (iso < start ? start : iso)
        setCustomRange({ startISO: start, endISO: safeEnd })
    }

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => buildExtraMaps(productExtras), [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalCOGS, productStats, soldProducts, lineChartData, offlineToday } = useMemo(() => {
        const pending = scope !== 'day' || offset !== 0 ? [] : getPendingOrders()
        const offlineToday = pending.filter(o => isSameDayVN(new Date(o.createdAt), new Date()))

        const agg = aggregateOrderStats({
            orders: [...displayOrders, ...offlineToday],
            productMap,
            extraPriceMap: extraMaps.priceMap,
            extraNameMap: extraMaps.nameMap,
            recipes, extraIngredients, ingredientCosts,
            selectedProductId: 'all',
        })

        return {
            totalRevenue: agg.totalRevenue,
            totalCOGS: agg.totalCOGS,
            productStats: agg.productStats,
            soldProducts: agg.soldProducts,
            lineChartData: buildHourlyLineChart(agg),
            offlineToday,
        }
    }, [displayOrders, productMap, extraMaps, recipes, extraIngredients, ingredientCosts, scope, offset])

    // totalCups separated: only reruns when filter or orders change, not on other UI state
    // When 'all' filter, products with count_as_cup=false are excluded; when filtering a specific product, always count it.
    const totalCups = useMemo(() => {
        let cups = 0
        const isExcluded = (pid) => productMap.get(pid)?.count_as_cup === false
        displayOrders.filter(o => !o.deleted_at).forEach(o => {
            ; (o.order_items || []).forEach(i => {
                const pid = i.product_id || i.productId
                if (selectedProductId === 'all') {
                    if (!isExcluded(pid)) cups += i.quantity || i.qty || 1
                } else if (selectedProductId === pid) {
                    cups += i.quantity || i.qty || 1
                }
            })
        })
        offlineToday.forEach(o => {
            ; (o.cart || o.orderItems || []).forEach(i => {
                if (selectedProductId === 'all') {
                    if (!isExcluded(i.productId)) cups += i.quantity || 1
                } else if (selectedProductId === i.productId) {
                    cups += i.quantity || 1
                }
            })
        })
        return cups
    }, [displayOrders, offlineToday, selectedProductId, productMap])

    const { dailyExpense, refillNvl, refillFreeForm } = useMemo(
        () => splitExpenses(displayExpenses),
        [displayExpenses]
    )
    // Vận hành tổng = trong ca + free-form sau ca (sau ca vẫn là vận hành, không phải NVL).
    // Thực chi: legacy is_fixed=true rows ĐÃ được splitExpenses cộng vào dailyExpense.
    const operationalExpense = dailyExpense + refillFreeForm

    // ── COGS category breakdown + hao hụt ────────────────────────────────────
    // Map ingredient → category (null when migration 20260523 not deployed yet —
    // splitCogsByCategory treats null as 'main' so the page still renders).
    const categoryByIngredient = useMemo(() => {
        const map = new Map()
        for (const c of ingredientConfigs || []) map.set(c.ingredient, c.category || null)
        return map
    }, [ingredientConfigs])

    const cogsByCategory = useMemo(
        () => splitCogsByCategory(
            [...displayOrders, ...offlineToday],
            recipes, extraIngredients, ingredientCosts, categoryByIngredient
        ),
        [displayOrders, offlineToday, recipes, extraIngredients, ingredientCosts, categoryByIngredient]
    )

    const lossValue = useMemo(() => {
        // Daily scope: today's single closing + yesterday as the opening source.
        // Range scope: all closings in the period + prev-period closings.
        const isDayScope = scope === 'day'
        const closings = isDayScope
            ? (shiftClosing ? [shiftClosing] : [])
            : (apiShiftClosings || [])
        if (closings.length === 0) return 0

        // Bucket orders by VN date string so calculateLossValue can look up
        // per-day consumption (same dayStr key the RangeLossCard uses).
        const itemsByDay = {}
        const pushItem = (dayStr, productId, qty, extras) => {
            if (!itemsByDay[dayStr]) itemsByDay[dayStr] = []
            itemsByDay[dayStr].push({ productId, qty, extras })
        }
        const sourceOrders = isDayScope ? [...displayOrders, ...offlineToday] : (apiOrders || [])
        for (const o of sourceOrders) {
            if (o.deleted_at) continue
            const dayStr = new Date(o.created_at || o.createdAt).toLocaleDateString('sv-SE')
            const items = o.order_items || o.cart || o.orderItems || []
            for (const i of items) {
                pushItem(
                    dayStr,
                    i.product_id || i.productId,
                    i.quantity || i.qty || 1,
                    i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
                )
            }
        }
        const dailyConsumption = {}
        for (const [dayStr, items] of Object.entries(itemsByDay)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients)
        }

        const prevClosings = isDayScope
            ? (yesterdayClosing ? [yesterdayClosing] : [])
            : (prevShiftClosings || [])
        return calculateLossValue({
            shiftClosings: closings,
            prevShiftClosings: prevClosings,
            dailyConsumption,
            ingredientConfigs,
        })
    }, [scope, shiftClosing, yesterdayClosing, apiShiftClosings, prevShiftClosings, apiOrders, displayOrders, offlineToday, recipes, extraIngredients, ingredientConfigs])

    // P&L = Revenue - COGS - Hao hụt - Tất cả chi phí thực chi. NVL không trừ (đã nằm trong COGS).
    const netProfit = totalRevenue - totalCOGS - lossValue - operationalExpense

    const yesterdayNetProfit = useMemo(() => {
        let rev = 0, cogs = 0
        yesterdayOrders.filter(o => !o.deleted_at).forEach(o => {
            rev += o.total
            if (o.total_cost > 0) {
                cogs += o.total_cost
            } else {
                ; (o.order_items || []).forEach(i => {
                    const qty = i.quantity || i.qty || 1
                    const pid = i.product_id || i.productId
                    const cost = i.unit_cost > 0 ? i.unit_cost : calculateProductCost(pid, [], recipes, extraIngredients, ingredientCosts)
                    cogs += cost * qty
                })
            }
        })
        // Thực chi: tổng mọi expense thực ra. NVL refill bị COGS đã trừ qua
        // o.total_cost → skip để không double-count.
        const expenseSum = yesterdayExpensesData.reduce((s, e) => {
            if (e.is_refill && !e.metadata?.free_form) return s
            return s + (e.amount || 0)
        }, 0)
        return (rev - cogs) - expenseSum
    }, [yesterdayOrders, yesterdayExpensesData, recipes, extraIngredients, ingredientCosts])

    // Sync cash flow calculations for both daily view and range view (handling unclosed shifts by falling back to expected order totals)
    const calculateSyncedCashFlow = (isDay, singleClosing, rangeClosings, rangeOrders, rangeOffline = []) => {
        if (isDay) {
            if (singleClosing) {
                return {
                    cash: singleClosing.actual_cash || 0,
                    transfer: singleClosing.actual_transfer || 0
                }
            }
            const orders = [...rangeOrders, ...rangeOffline].filter(o => !o.deleted_at)
            const cash = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
            const transfer = orders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
            return { cash, transfer }
        }

        const closingMap = new Map()
            ; (rangeClosings || []).forEach(s => {
                const dateStr = dateStringVN(new Date(s.closed_at || s.created_at))
                if (!closingMap.has(dateStr)) {
                    closingMap.set(dateStr, { cash: 0, transfer: 0 })
                }
                const val = closingMap.get(dateStr)
                val.cash += s.actual_cash || 0
                val.transfer += s.actual_transfer || 0
            })

        const ordersByDate = new Map()
        const allOrders = [...rangeOrders, ...rangeOffline].filter(o => !o.deleted_at)
        allOrders.forEach(o => {
            const dateStr = dateStringVN(new Date(o.created_at || o.createdAt))
            if (!ordersByDate.has(dateStr)) {
                ordersByDate.set(dateStr, [])
            }
            ordersByDate.get(dateStr).push(o)
        })

        const allDates = new Set([...closingMap.keys(), ...ordersByDate.keys()])

        let totalCash = 0
        let totalTransfer = 0

        allDates.forEach(dateStr => {
            if (closingMap.has(dateStr)) {
                const closing = closingMap.get(dateStr)
                totalCash += closing.cash
                totalTransfer += closing.transfer
            } else {
                const orders = ordersByDate.get(dateStr) || []
                const cash = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
                const transfer = orders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
                totalCash += cash
                totalTransfer += transfer
            }
        })

        return { cash: totalCash, transfer: totalTransfer }
    }

    // calculateSyncedCashFlow returns { cash, transfer } — alias on destructure to keep
    // the rest of the page calling them actualCash/actualTransfer.
    const { cash: actualCash, transfer: actualTransfer } = useMemo(() => {
        return calculateSyncedCashFlow(scope === 'day', shiftClosing, apiShiftClosings, displayOrders, offlineToday)
    }, [scope, shiftClosing, apiShiftClosings, displayOrders, offlineToday])

    // Inventory audit support: estimated consumption per ingredient + cups-equivalent
    // product map + per-product breakdown for expand-on-tap.
    const todayOrderItems = useMemo(() => {
        if (!isTodayScope) return []
        const items = []
        todayOrders.filter(o => !o.deleted_at && !o.deletedAt).forEach(o => {
            (o.order_items || []).forEach(i => items.push({
                productId: i.product_id || i.productId,
                qty: i.quantity || i.qty || 1,
                extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
            }))
        })
        offlineToday.forEach(o => {
            (o.cart || o.orderItems || []).forEach(i => items.push({
                productId: i.productId,
                qty: i.quantity || 1,
                extras: i.extras || []
            }))
        })
        return items
    }, [isTodayScope, todayOrders, offlineToday])

    const usedMap = useMemo(
        () => calculateEstimatedConsumption(todayOrderItems, recipes, extraIngredients),
        [todayOrderItems, recipes, extraIngredients]
    )

    const consumptionBreakdown = useMemo(
        () => calculateConsumptionBreakdown(todayOrderItems, recipes, extraIngredients, products, productExtras),
        [todayOrderItems, recipes, extraIngredients, products, productExtras]
    )

    // Dominant product per ingredient — drives "Tương đương N ly <product>" on the
    // Hao hụt row. Pick the recipe with the highest sales volume; skip cup/lid
    // passthroughs (amountPerCup === 1) and ingredients that don't map to a named product.
    const ingredientToProduct = useMemo(() => {
        const sales = {}
        todayOrderItems.forEach(i => { sales[i.productId] = (sales[i.productId] || 0) + (i.qty || 1) })
        const map = {}
        ;(recipes || []).forEach(r => {
            if (!r.amount || r.amount <= 0) return
            const s = sales[r.product_id] || 0
            const cur = map[r.ingredient]
            if (!cur || s > cur.sales) {
                map[r.ingredient] = { productId: r.product_id, amountPerCup: r.amount, sales: s }
            }
        })
        for (const ing of Object.keys(map)) {
            const ref = map[ing]
            const p = products.find(pp => pp.id === ref.productId)
            if (!p?.name || ref.amountPerCup === 1) { delete map[ing]; continue }
            ref.productName = p.name.toLowerCase()
        }
        return map
    }, [recipes, products, todayOrderItems])

    // Sum today's orders (online + offline) for the system_total_revenue snapshot we send
    // when creating a new shift_closing. Mirrors /shift-closing's calculation.
    const systemTotalRevenue = useMemo(() => {
        if (!isTodayScope) return 0
        let sum = 0
        for (const o of todayOrders) if (!o.deleted_at && !o.deletedAt) sum += o.total || 0
        for (const o of offlineToday) if (!o.deleted_at && !o.deletedAt) sum += o.total || 0
        return sum
    }, [isTodayScope, todayOrders, offlineToday])

    const handleSaveInventory = async () => {
        if (!selectedAddress?.id) return
        if (inventory.restockOverflowIngredients.length > 0) {
            window.alert(`Không thể lưu: ${inventory.restockOverflowIngredients.length} nguyên liệu có "Lấy ra" vượt quá kho tổng. Vào /ingredients → + Nhập kho trước, hoặc giảm số "Lấy ra".`)
            return
        }
        // Confirm before committing — chốt ca is coarse and not easily reversible.
        if (!window.confirm(inventory.existingClosing?.id ? 'Cập nhật báo cáo tồn kho?' : 'Xác nhận lưu báo cáo?')) return

        const inventoryReport = inventory.buildInventoryReport()
        // Cash/transfer/note are owned by the cashflow card — only seed defaults on first
        // insert; updates leave them untouched so the cashflow Lưu thực thu values stick.
        const payload = {
            address_id: selectedAddress.id,
            inventory_report: inventoryReport,
        }
        if (!inventory.existingClosing?.id) {
            payload.closed_by = profile?.id || null
            payload.system_total_revenue = systemTotalRevenue
            payload.actual_cash = parseVNDInput(cashInput) || 0
            payload.actual_transfer = parseVNDInput(transferInput) || 0
            payload.note = ''
        }

        try {
            await saveShiftClosing(payload, {
                existingId: inventory.existingClosing?.id,
            })
            showToast('Đã lưu báo cáo tồn kho', 'success')
            inventory.resetDirty()
            // Refresh shift_closing so future edits land as updates instead of inserts.
            const fresh = await fetchDailyReportContext(selectedAddress.id)
            setShiftClosing(fresh?.shift_closing || null)
            if (fresh?.shift_closing) inventory.setExistingClosing(fresh.shift_closing)
        } catch (err) {
            showError(err, 'Lưu báo cáo tồn kho')
        }
    }

    const handleSaveCashflow = async () => {
        if (!selectedAddress?.id) return
        const payload = {
            address_id: selectedAddress.id,
            closed_by: profile?.id || null,
            system_total_revenue: systemTotalRevenue,
            actual_cash: parseVNDInput(cashInput) || 0,
            actual_transfer: parseVNDInput(transferInput) || 0,
        }
        // On insert we also need inventory_report (empty if not provided yet) and a note;
        // on update we preserve whatever the existing row has — only the cash fields change.
        if (!shiftClosing?.id) {
            payload.inventory_report = []
            payload.note = ''
        }
        try {
            await saveShiftClosing(payload, {
                existingId: shiftClosing?.id,
            })
            showToast('Đã lưu thực thu', 'success')
            setCashDirty(false)
            // Refetch shift_closing so display + pre-fill sync. invalidateDailyContext
            // inside the hook already cleared the cache, so the network is hit fresh.
            const fresh = await fetchDailyReportContext(selectedAddress.id)
            setShiftClosing(fresh?.shift_closing || null)
        } catch (err) {
            showError(err, 'Lưu thực thu')
        }
    }

    if (!entitlementLoading && !hasFeature(activeModules, 'reports')) {
        return <UpsellPage required="basic" backTo="/history" />
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <HistoryHeader
                rangeLabel={rangeLabel}
                scope={scope}
                onBack={() => navigate(backTo)}
                onForward={() => navigate('/recipes')}
                activeTab="report"
                onTabSelect={(tab) => {
                    if (tab === 'report') return
                    navigate('/history', { replace: true, state: { from: backTo, tab } })
                }}
                canGoForward={offset < 0}
                onOffsetPrev={() => setOffset(p => p - 1)}
                onOffsetNext={() => setOffset(p => p + 1)}
                dayInputValue={dayInputValue}
                dayCustomDate={dayCustomDate}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={handlePrevDay}
                onNextDay={handleNextDay}
                onDateChange={handleManualDatePick}
                onEndDatePick={handleDayEndPick}
                hasManualPick={hasManualPick}
                customRange={customRange}
                onCustomStartChange={handleCustomStartChange}
                onCustomEndChange={handleCustomEndChange}
                belowTabs={<ReportViewFilter value={view} onChange={setView} />}
            />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-6 space-y-4 bg-bg">
                {!isReady ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-light rounded-[24px] h-[72px]" />)}
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-[62px]" />
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-light rounded-[24px] h-[72px]" />)}
                            <div className="col-span-2 bg-surface-light rounded-[24px] h-[72px]" />
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-52" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">
                        {/* {view === VIEW_PROFIT && (
                            <SalesCard
                                totalCups={totalCups}
                                selectedProductId={selectedProductId}
                                onFilterChange={setSelectedProductId}
                                products={products}
                                soldProducts={soldProducts}
                                totalRevenue={totalRevenue}
                                productStats={productStats}
                                lineChartData={lineChartData}
                            />
                        )} */}

                        {(view === VIEW_ALL || view === VIEW_PROFIT) && !isStaff && (
                            <FinanceCards
                                totalRevenue={totalRevenue}
                                totalCOGS={totalCOGS}
                                netProfit={netProfit}
                                yesterdayNetProfit={yesterdayNetProfit}
                                expenses={displayExpenses}
                                expenseCategories={expenseCategories}
                                cogsByCategory={cogsByCategory}
                                lossValue={lossValue}
                                onRecipesClick={() => navigate('/recipes', { state: { from: '/daily-report' } })}
                            />
                        )}

                        {(view === VIEW_ALL || view === VIEW_CASHFLOW) && (
                            <CashFlowCard
                                actualCash={actualCash}
                                actualTransfer={actualTransfer}
                                dailyExpense={dailyExpense}
                                refillNvl={refillNvl}
                                refillFreeForm={refillFreeForm}
                                expenses={displayExpenses}
                                editable={isTodayScope}
                                cashInput={cashInput}
                                transferInput={transferInput}
                                onCashChange={(v) => setCashInput(formatVNDInput(v))}
                                onTransferChange={(v) => setTransferInput(formatVNDInput(v))}
                                isSaving={isSavingShift}
                                onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                salesCard={
                                    <SalesCard
                                        totalCups={totalCups}
                                        selectedProductId={selectedProductId}
                                        onFilterChange={setSelectedProductId}
                                        products={products}
                                        soldProducts={soldProducts}
                                        totalRevenue={totalRevenue}
                                        productStats={productStats}
                                        lineChartData={lineChartData}
                                    />
                                }
                            />
                        )}

                        {(view === VIEW_ALL || view === VIEW_INVENTORY) && (
                            <>
                                {view === VIEW_ALL && (
                                    <div className="flex items-center gap-3 py-1 my-1 px-4">
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tồn kho</span>
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                    </div>
                                )}

                                {/* Today: editable inventory report + refill forecast tabs. */}
                                {/* Past date: read-only audit + refill view via InventoryRefillCard. */}
                                {isTodayScope ? (
                                    <div className="flex flex-col gap-3">
                                        {isShiftFinalized ? (
                                            <div className="flex items-center justify-center gap-2 bg-success/10 border border-success/30 px-3 py-2 rounded-[10px] text-success">
                                                <span className="text-[12px] font-bold uppercase tracking-wide">✓ Đã hoàn tất ca hôm nay</span>
                                            </div>
                                        ) : finalizeMissing && finalizeMissing.length > 0 ? (
                                            <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 px-3 py-2 rounded-[10px] text-warning">
                                                <span className="text-[12px] font-bold leading-snug">
                                                    <span className="uppercase tracking-wide">Chưa hoàn tất:</span>{' '}
                                                    {finalizeMissing.join(' · ')}
                                                </span>
                                            </div>
                                        ) : null}

                                        <div className="flex p-1 bg-surface-light rounded-[12px] gap-1 w-full">
                                            <button
                                                onClick={() => setInventoryTab('report')}
                                                className={`flex-1 py-1.5 rounded-[10px] uppercase text-[13px] font-bold transition-all ${inventoryTab === 'report' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                                            >
                                                Hao hụt
                                            </button>
                                            <button
                                                onClick={() => setInventoryTab('refill')}
                                                className={`flex-1 py-1.5 rounded-[10px] uppercase text-[13px] font-bold transition-all ${inventoryTab === 'refill' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                                            >
                                                Bổ sung
                                            </button>
                                        </div>

                                        {inventoryTab === 'report' ? (
                                            <InventoryReportCard
                                                ingredientsList={inventory.ingredientsList}
                                                isLoading={inventory.isLoadingIngredients}
                                                openingStock={inventory.openingStock}
                                                openingInputs={inventory.openingInputs}
                                                openingLocked={inventory.openingLocked}
                                                restockInputs={inventory.restockInputs}
                                                inventoryInputs={inventory.inventoryInputs}
                                                warehouseStocks={inventory.effectiveWarehouseStocks}
                                                ingredientUnits={Object.fromEntries(inventory.ingredientsList.map(i => [i.ingredient, i.unit]))}
                                                usedMap={usedMap}
                                                consumptionBreakdown={consumptionBreakdown}
                                                ingredientToProduct={ingredientToProduct}
                                                canUnlock={!isStaff}
                                                isSubmitting={isSavingShift}
                                                baselineInputs={inventory.baselineSnapshot}
                                                baselineVersion={inventory.baselineVersion}
                                                onOpeningChange={inventory.onOpeningChange}
                                                onOpeningLock={inventory.onOpeningLock}
                                                onRestockChange={inventory.onRestockChange}
                                                onInventoryChange={inventory.onInventoryChange}
                                            />
                                        ) : (
                                            <InventoryRefillCard
                                                shiftClosing={shiftClosing}
                                                yesterdayClosing={yesterdayClosing}
                                                todayOrders={displayOrders}
                                                offlineToday={offlineToday}
                                                recipes={recipes}
                                                extraIngredients={extraIngredients}
                                                selectedAddress={selectedAddress}
                                                products={products}
                                                productExtras={productExtras}
                                                ingredientUnits={ingredientUnits}
                                                isPastDate={false}
                                                canAccessAudit={hasFeature(activeModules, 'lossAudit')}
                                                forcedTab="refill"
                                            />
                                        )}
                                    </div>
                                ) : scope === 'day' ? (
                                    <InventoryRefillCard
                                        shiftClosing={shiftClosing}
                                        yesterdayClosing={yesterdayClosing}
                                        todayOrders={displayOrders}
                                        offlineToday={[]}
                                        recipes={recipes}
                                        extraIngredients={extraIngredients}
                                        selectedAddress={selectedAddress}
                                        products={products}
                                        productExtras={productExtras}
                                        ingredientUnits={ingredientUnits}
                                        isPastDate={true}
                                        canAccessAudit={hasFeature(activeModules, 'lossAudit')}
                                    />
                                ) : (
                                    // Range scopes (week/month/custom): aggregate loss across all
                                    // closings in the period — mirrors what /range-report shows.
                                    <RangeLossCard
                                        orders={apiOrders}
                                        shiftClosings={apiShiftClosings}
                                        prevShiftClosings={prevShiftClosings}
                                        recipes={recipes}
                                        extraIngredients={extraIngredients}
                                        ingredientUnits={ingredientUnits}
                                        isLocked={!hasFeature(activeModules, 'lossAudit')}
                                        onUnlockClick={() => setShowLossUpsell(true)}
                                    />
                                )}
                            </>
                        )}

                        <div className="flex flex-col items-center justify-center p-3">
                            <a href="https://github.com/billdeptrai0512" target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-[#c8956c]/40 hover:bg-[#c8956c]/5 transition-all duration-300">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap mt-[1px] bg-clip-text text-transparent"
                                    style={{ backgroundImage: 'linear-gradient(135deg, #c8956c, #e2b77d, #d4a06a, #b8865a)' }}>
                                    Developed by billdeptrai0512
                                </span>
                            </a>
                        </div>
                    </div>
                )}
            </main>

            {/* FABs: Lưu thực thu + Lưu báo cáo — both floating bottom-right with the same
                CTA style (bg-primary + text-black), each auto-hidden until its section is dirty.
                Stacked when both appear (view = all + both dirty). */}
            {isTodayScope && (
                (((view === VIEW_ALL || view === VIEW_CASHFLOW) && cashDirty) ||
                 ((view === VIEW_ALL || view === VIEW_INVENTORY) && inventoryTab === 'report' && inventory.isDirty)) && (
                    <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40">
                        <div className="flex flex-col items-end gap-2 px-4 mb-[72px] pointer-events-auto">
                            {(view === VIEW_ALL || view === VIEW_CASHFLOW) && cashDirty && (
                                <button
                                    onClick={handleSaveCashflow}
                                    disabled={isSavingShift}
                                    className="bg-primary text-black rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isSavingShift ? 'Đang lưu...' : 'Lưu thực thu'}
                                </button>
                            )}
                            {(view === VIEW_ALL || view === VIEW_INVENTORY) && inventoryTab === 'report' && inventory.isDirty && (
                                <button
                                    onClick={handleSaveInventory}
                                    disabled={isSavingShift}
                                    className="bg-primary text-black rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isSavingShift ? 'Đang lưu...' : 'Lưu báo cáo'}
                                </button>
                            )}
                        </div>
                    </div>
                )
            )}

            <HistoryFooter
                scope={scope}
                onScopeChange={(range) => {
                    if (range !== scope) {
                        setScope(range)
                        setOffset(0)
                        setHasManualPick(false)
                    }
                }}
            />
            <Toast toast={toast} />
            <UpsellSheet
                open={showLossUpsell}
                onClose={() => setShowLossUpsell(false)}
                required="pro"
            />
        </div>
    )
}
