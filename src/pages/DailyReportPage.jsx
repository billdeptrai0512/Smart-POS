import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost, formatVNDInput, parseVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchLastWeekSameDayOrderItems } from '../services/orderService'
import { useShiftClosingSave } from '../hooks/useShiftClosingSave'
import { useShiftInventoryState } from '../hooks/useShiftInventoryState'
import { useDailyReportData } from '../hooks/useDailyReportData'
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, splitCogsByCategory, calculateLossValue } from '../utils/inventory'
import { ingredientLabel } from '../utils/ingredients'
import { dateStringVN, isSameDayVN } from '../utils/dateVN'
import { useDateScope } from '../hooks/useDateScope'
import { goToMenuStep } from '../utils/menuSequence'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import SalesCard from '../components/DailyReportPage/SalesCard'
import DayPerformanceChart from '../components/DailyReportPage/DayPerformanceChart'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import { fetchExpenseCategories } from '../services/expenseService'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'
import InventoryReportCard from '../components/DailyReportPage/InventoryReportCard'
import ShiftPrepCard from '../components/DailyReportPage/ShiftPrepCard'
import RangeLossCard from '../components/DailyReportPage/RangeLossCard'
import { Truck, Package } from 'lucide-react'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY } from '../components/DailyReportPage/ReportViewFilter'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useEntitlement, hasModule } from '../hooks/useEntitlement'
import SubscriptionScreen from '../components/common/SubscriptionScreen'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { shiftFinalizedKey, cashClosedKey } from '../constants/storageKeys'

// Đọc tick "đã soạn" từ localStorage (bền qua reload/đóng tab), theo address+ngày.
function readPrep(key) {
    if (!key) return {}
    try { return JSON.parse(localStorage.getItem(key)) || {} } catch { return {} }
}

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

    // Date selection (scope/offset/customRange + every transition handler) lives in
    // the shared hook so /daily-report and /history stay in lock-step. Seeded from
    // nav state so a week/month/custom window survives the Nhật ký ↔ Báo cáo switch.
    const date = useDateScope(location.state)
    const {
        scope, offset, customRange, hasManualPick,
        dayInputValue, canGoForwardDay, canGoForwardPeriod, navState: dateNavState,
        goPrevDay, goNextDay, goOffsetPrev, goOffsetNext,
        applyRange, shiftRange, canShiftRangeForward, applyPreset, goToDate,
    } = date


    // Deep-link: open on a specific past date passed via nav state (e.g. from a
    // "xem ngày X" link). Runs once; the hook clamps future dates to today.
    useEffect(() => {
        if (initialDate && initialDate !== dateStringVN(new Date())) goToDate(initialDate)
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        apiPayments,
        todayPayments,
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

    // Same-day-last-week order items — feeds the refill forecast ("Bổ sung mai")
    // inside InventoryReportCard. Today scope only; cached per address+day.
    const [lastWeekItems, setLastWeekItems] = useState([])

    // "Soạn cho mai" tick state — lifted here (chứ không nằm trong ShiftPrepCard) vì nó
    // là một điều kiện để chốt ca. Lưu localStorage theo address+ngày; re-seed bằng cách
    // so khớp key trong render (không dùng effect → tránh cascading render).
    const prepStorageKey = isTodayScope && selectedAddress?.id ? `shiftPrep_${selectedAddress.id}_${todayISO}` : null
    const [prepChecked, setPrepChecked] = useState(() => readPrep(prepStorageKey))
    const [seenPrepKey, setSeenPrepKey] = useState(prepStorageKey)
    if (prepStorageKey !== seenPrepKey) {
        setSeenPrepKey(prepStorageKey)
        setPrepChecked(readPrep(prepStorageKey))
    }
    const togglePrep = useCallback((ingredient) => {
        setPrepChecked(prev => {
            const next = { ...prev, [ingredient]: !prev[ingredient] }
            if (prepStorageKey) {
                try { localStorage.setItem(prepStorageKey, JSON.stringify(next)) } catch { /* storage full */ }
            }
            return next
        })
    }, [prepStorageKey])

    // "Chuẩn bị tồn kho" tick state — song song với prepChecked (lưu riêng key). Không
    // gate chốt ca, chỉ để đánh dấu đã đi chợ đắp kho cho mai.
    const warehousePrepStorageKey = isTodayScope && selectedAddress?.id ? `warehousePrep_${selectedAddress.id}_${todayISO}` : null
    const [warehousePrepChecked, setWarehousePrepChecked] = useState(() => readPrep(warehousePrepStorageKey))
    const [seenWarehousePrepKey, setSeenWarehousePrepKey] = useState(warehousePrepStorageKey)
    if (warehousePrepStorageKey !== seenWarehousePrepKey) {
        setSeenWarehousePrepKey(warehousePrepStorageKey)
        setWarehousePrepChecked(readPrep(warehousePrepStorageKey))
    }
    const toggleWarehousePrep = useCallback((ingredient) => {
        setWarehousePrepChecked(prev => {
            const next = { ...prev, [ingredient]: !prev[ingredient] }
            if (warehousePrepStorageKey) {
                try { localStorage.setItem(warehousePrepStorageKey, JSON.stringify(next)) } catch { /* storage full */ }
            }
            return next
        })
    }, [warehousePrepStorageKey])

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

    // Base chốt-ca: persisted shift_closing có cash + transfer VÀ mọi NVL đã đếm Cuối kỳ.
    // Điều kiện "đã hoàn tất" đầy đủ (gồm 'đã soạn cho hôm nay') ghép thêm bên dưới sau
    // prepTodayList, vì allPrepDone phụ thuộc prepTodayList — xem isShiftFinalized.
    const cashAndCountDone = useMemo(() => {
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

    // Week/month scopes show the per-day/per-week bar chart instead of the hourly line.
    const isRangeScope = scope === 'week' || scope === 'month'

    // Computed display data
    const displayOrders = isTodayScope ? todayOrders : apiOrders
    const displayExpenses = isTodayScope ? todayExpenses : apiExpenses
    // Payments của ngày scope hiện tại — driver chính của cashflow refill (paid_at-based).
    const displayPayments = isTodayScope ? (todayPayments || []) : (apiPayments || [])

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
    }, [scope, rangeStart, rangeEnd, customRange])

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => buildExtraMaps(productExtras), [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalDiscount, totalCOGS, productStats, soldProducts, lineChartData, offlineToday } = useMemo(() => {
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
            totalDiscount: agg.totalDiscount,
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

    const { dailyExpense, refillFreeForm } = useMemo(
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

    // Fetch same-day-last-week orders once per address (today scope only). The service
    // caches by address+day, so this is cheap on re-mounts.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress?.id) { setLastWeekItems([]); return }
        let alive = true
        fetchLastWeekSameDayOrderItems(selectedAddress.id)
            .then(items => { if (alive) setLastWeekItems(items || []) })
            .catch(() => { if (alive) setLastWeekItems([]) })
        return () => { alive = false }
    }, [isTodayScope, selectedAddress?.id])

    const lastWeekUsedMap = useMemo(() => {
        const items = lastWeekItems.map(i => ({
            productId: i.product_id,
            qty: i.quantity,
            extras: (i.extra_ids || []).map(id => ({ id })),
        }))
        return calculateEstimatedConsumption(items, recipes, extraIngredients)
    }, [lastWeekItems, recipes, extraIngredients])

    const r1Inv = (n) => Math.round((Number(n) || 0) * 10) / 10
    const byLabelInv = (ingredient, map) => {
        if (map[ingredient] != null) return map[ingredient]
        const label = ingredientLabel(ingredient).toLowerCase()
        for (const [k, v] of Object.entries(map)) if (k !== ingredient && ingredientLabel(k).toLowerCase() === label) return v
        return 0
    }
    const forecastFor = (ingredient) =>
        Math.max(r1Inv(byLabelInv(ingredient, usedMap)), r1Inv(byLabelInv(ingredient, lastWeekUsedMap)))

    // Item chung cho 2 card checklist: { ingredient, have, need, needPacks, unit, packUnit }.
    //   have = tồn hiện có ("Còn"); need = target − have ("Cần"); needPacks = quy đổi ra bịch.
    //   target = mức cần đạt: card Soạn = forecast; card Kho = max(forecast, min_stock).
    const toPrepItem = (ing, have, target) => {
        const need = r1Inv(target - have)
        if (need <= 0) return null
        const packSize = Number(ing.pack_size) || 0
        return {
            ingredient: ing.ingredient,
            have,
            need,
            needPacks: packSize > 0 ? Math.ceil(need / packSize) : 0,
            unit: ing.unit,
            packUnit: ing.pack_unit,
        }
    }

    // "Soạn cho hôm nay" — sáng: đưa NVL ra QUẦY đủ cho dự báo bán hôm nay.
    // have = tồn quầy ĐẦU ca (opening); need = forecast − opening. Dự báo =
    // max(tiêu thụ hôm nay, cùng kỳ tuần trước). KHÔNG dùng min_stock (đó là ngưỡng kho).
    const prepTodayList = useMemo(() => {
        const out = []
        for (const ing of inventory.ingredientsList || []) {
            const oRaw = inventory.openingInputs[ing.ingredient]
            const opening = r1Inv(oRaw !== undefined && oRaw !== '' ? oRaw : (inventory.openingStock[ing.ingredient] ?? 0))
            const item = toPrepItem(ing, opening, forecastFor(ing.ingredient))
            if (item) out.push(item)
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory.ingredientsList, inventory.openingInputs, inventory.openingStock, usedMap, lastWeekUsedMap])

    // "Chuẩn bị tồn kho" — cho mai: đủ hàng để mai SOẠN RA BÁN không? Liên kết 3 card:
    // mai bán từ TỔNG tồn = kho tổng + tồn quầy cuối ca (số ② Hao hụt vừa đếm). Thiếu thì mua.
    //   have = tổng tồn = (kho tổng − restock) + tồn quầy cuối ca.
    //   target = max(forecast, min_stock) — mua để đạt mức cao hơn giữa "đủ bán mai" và
    //            "sàn tồn tối thiểu" của NVL (đồng bộ với min_stock cấu hình ở /ingredients).
    //   need = target − tổng tồn.
    //   Lưu ý: effectiveWarehouseStocks là kho TRƯỚC khi trừ restock của ca này (xem
    //   useShiftInventoryState), nên phải trừ restock để khỏi đếm 2 lần phần đã rút ra quầy.
    //   Chưa đếm Cuối kỳ → ước lượng quầy theo Lý thuyết (Đầu kỳ + Nhập thêm − Sử dụng).
    const warehousePrepList = useMemo(() => {
        const out = []
        for (const ing of inventory.ingredientsList || []) {
            const warehouse = Math.max(0, r1Inv(byLabelInv(ing.ingredient, inventory.effectiveWarehouseStocks || {})))
            const restock = r1Inv(inventory.restockInputs[ing.ingredient])
            const counted = inventory.inventoryInputs[ing.ingredient]
            let counter
            if (counted !== undefined && counted !== '') {
                counter = r1Inv(counted)
            } else {
                const oRaw = inventory.openingInputs[ing.ingredient]
                const opening = r1Inv(oRaw !== undefined && oRaw !== '' ? oRaw : (inventory.openingStock[ing.ingredient] ?? 0))
                const used = r1Inv(byLabelInv(ing.ingredient, usedMap))
                counter = Math.max(0, r1Inv(opening + restock - used))
            }
            const total = Math.max(0, r1Inv(warehouse - restock + counter))
            const target = Math.max(forecastFor(ing.ingredient), r1Inv(ing.min_stock || 0))
            const item = toPrepItem(ing, total, target)
            if (item) out.push(item)
        }
        return out
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inventory.ingredientsList, inventory.effectiveWarehouseStocks, inventory.restockInputs, inventory.inventoryInputs, inventory.openingInputs, inventory.openingStock, usedMap, lastWeekUsedMap])

    // Chốt ca đầy đủ = cash + counted + đã soạn cho hôm nay + đã chuẩn bị tồn kho cho mai.
    // List rỗng (đủ tồn, không cần làm gì) ⇒ coi như đã xong phần đó.
    const allPrepDone = prepTodayList.length === 0 || prepTodayList.every(it => prepChecked[it.ingredient])
    const allWarehousePrepDone = warehousePrepList.length === 0 || warehousePrepList.every(it => warehousePrepChecked[it.ingredient])
    const isShiftFinalized = cashAndCountDone && allPrepDone && allWarehousePrepDone

    // Accordion 3 card Tồn kho: mặc định chỉ mở card của BƯỚC hiện tại trong flow.
    //   chưa soạn xong → 'prep'; soạn xong, chưa kiểm xong → 'audit'; kiểm xong → 'warehouse'.
    // Khi sang bước mới thì tự mở card bước đó (sync trong render, không dùng effect — giống
    // cách re-seed prepChecked); user vẫn bấm header để mở card khác trong cùng bước.
    const allCounted = (inventory.ingredientsList?.length || 0) > 0 &&
        inventory.ingredientsList.every(ing => {
            const v = inventory.inventoryInputs[ing.ingredient]
            return v !== undefined && v !== ''
        })
    const activeStage = !allPrepDone ? 'prep' : !allCounted ? 'audit' : 'warehouse'
    const [expandedCard, setExpandedCard] = useState(activeStage)
    const [seenStage, setSeenStage] = useState(activeStage)
    if (activeStage !== seenStage) {
        setSeenStage(activeStage)
        setExpandedCard(activeStage)
    }
    const toggleCard = (id) => setExpandedCard(cur => (cur === id ? null : id))

    // Sync cờ chốt ca → localStorage để HistoryPage phân loại chi phí phát sinh sau là "Sau ca".
    useEffect(() => {
        if (!isTodayScope || !selectedAddress?.id) return
        const key = shiftFinalizedKey(selectedAddress.id, todayISO)
        if (isShiftFinalized) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, Date.now().toString())
        } else {
            localStorage.removeItem(key)
        }
    }, [isShiftFinalized, isTodayScope, selectedAddress?.id, todayISO])

    // Sync cờ chốt ca tiền → localStorage để HistoryPage nhận diện đã chốt két.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress?.id) return
        const key = cashClosedKey(selectedAddress.id, todayISO)
        const isCashClosed = isTodaysClosing && shiftClosing?.cash_closed_at != null
        if (isCashClosed) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, Date.now().toString())
        } else {
            localStorage.removeItem(key)
        }
    }, [isTodaysClosing, shiftClosing?.cash_closed_at, isTodayScope, selectedAddress?.id, todayISO])

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
            // "Lưu thực thu" = chốt ca tiền. Đặt mốc lần đầu, giữ nguyên các lần sửa số
            // sau (không dời mốc, để các khoản chi giữa 2 lần lưu không bị đổi phân loại).
            cash_closed_at: shiftClosing?.cash_closed_at || new Date().toISOString(),
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
            // Refetch shift_closing so display + pre-fill sync. invalidateDailyContext
            // inside the hook already cleared the cache, so the network is hit fresh.
            const fresh = await fetchDailyReportContext(selectedAddress.id)
            setShiftClosing(fresh?.shift_closing || null)
        } catch (err) {
            showError(err, 'Lưu thực thu')
        }
    }

    // Gate theo từng view: view hiện tại = 1 module. Nếu module đó chưa mua →
    // early-return NGUYÊN trang đăng ký gói (chrome riêng, back về /pos) thay vì
    // bọc panel trong header/footer báo cáo. Cùng UI với route /subscription.
    const viewModule = view === VIEW_CASHFLOW ? 'cashflow'
        : view === VIEW_INVENTORY ? 'inventory'
        : view === VIEW_PROFIT ? 'finance'
        : null
    if (!entitlementLoading && viewModule && !hasModule(activeModules, viewModule)) {
        return (
            <SubscriptionScreen
                backTo="/pos"
                preselectModule={viewModule}
                preselectAddressId={selectedAddress?.id}
                onDone={() => window.location.reload()}
            />
        )
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <HistoryHeader
                rangeLabel={rangeLabel}
                scope={scope}
                onBack={() => goToMenuStep('report', -1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard })}
                onForward={() => goToMenuStep('report', +1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard })}
                activeTab="report"
                onTabSelect={(tab) => {
                    if (tab === 'report') return
                    navigate('/history', { replace: true, state: { from: backTo, tab, ...dateNavState } })
                }}
                canGoForward={canGoForwardPeriod}
                onOffsetPrev={goOffsetPrev}
                onOffsetNext={goOffsetNext}
                rangeStartISO={rangeStart ? dateStringVN(rangeStart) : undefined}
                rangeEndISO={rangeEnd ? dateStringVN(rangeEnd) : undefined}
                dayInputValue={dayInputValue}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={goPrevDay}
                onNextDay={goNextDay}
                customRange={customRange}
                onRangeChange={applyRange}
                onShiftRange={shiftRange}
                canShiftRangeForward={canShiftRangeForward}
                onPresetSelect={applyPreset}
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
                        {(view === VIEW_ALL || view === VIEW_PROFIT) && !isStaff && (
                            <FinanceCards
                                totalRevenue={totalRevenue}
                                totalDiscount={totalDiscount}
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
                                refillFreeForm={refillFreeForm}
                                expenses={displayExpenses}
                                payments={displayPayments}
                                editable={isTodayScope}
                                cashInput={cashInput}
                                transferInput={transferInput}
                                onCashChange={(v) => setCashInput(formatVNDInput(v))}
                                onTransferChange={(v) => setTransferInput(formatVNDInput(v))}
                                isSaving={isSavingShift}
                                onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                salesCard={
                                    <div className="flex flex-col gap-4">
                                        <SalesCard
                                            totalCups={totalCups}
                                            selectedProductId={selectedProductId}
                                            onFilterChange={setSelectedProductId}
                                            products={products}
                                            soldProducts={soldProducts}
                                            totalRevenue={totalRevenue}
                                            productStats={productStats}
                                            lineChartData={lineChartData}
                                            showChart={!isRangeScope}
                                        />
                                        {isRangeScope && (
                                            <DayPerformanceChart
                                                orders={displayOrders}
                                                range={scope}
                                                start={rangeStart}
                                                end={rangeEnd}
                                                products={products}
                                            />
                                        )}
                                    </div>
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

                                {/* Today: editable inventory report — hao hụt + refill ("Bổ sung mai") merged per row. */}
                                {/* Past date: read-only audit + refill view via InventoryRefillCard. */}
                                {isTodayScope ? (
                                    <div className="flex flex-col gap-3">
                                        {/* Flow trong ngày: ① Soạn cho hôm nay → ② Hao hụt (cuối ca) → ③ Chuẩn bị tồn kho (cho mai) */}
                                        <ShiftPrepCard
                                            title="Soạn cho hôm nay"
                                            icon={<Truck size={15} className="text-primary shrink-0" />}
                                            packVerb="Lấy"
                                            emptyTitle="Đủ hàng cho hôm nay!"
                                            emptyHint="Tồn quầy đầu ca đã đủ cho dự báo bán hôm nay."
                                            items={prepTodayList}
                                            checked={prepChecked}
                                            onToggle={togglePrep}
                                            open={expandedCard === 'prep'}
                                            onToggleOpen={() => toggleCard('prep')}
                                        />

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
                                            open={expandedCard === 'audit'}
                                            onToggleOpen={() => toggleCard('audit')}
                                        />

                                        <ShiftPrepCard
                                            title="Chuẩn bị tồn kho"
                                            icon={<Package size={15} className="text-primary shrink-0" />}
                                            packVerb="Mua"
                                            emptyTitle="Kho tổng đủ cho mai!"
                                            emptyHint="Không cần đi chợ đắp thêm cho ngày mai."
                                            items={warehousePrepList}
                                            checked={warehousePrepChecked}
                                            onToggle={toggleWarehousePrep}
                                            open={expandedCard === 'warehouse'}
                                            onToggleOpen={() => toggleCard('warehouse')}
                                        />

                                        {isShiftFinalized && (
                                            <div className="flex items-center justify-center gap-2 bg-success/10 border border-success/30 px-3 py-2 rounded-[10px] text-success">
                                                <span className="text-[12px] font-bold uppercase tracking-wide">✓ Đã hoàn tất ca hôm nay</span>
                                            </div>
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
                                    />
                                ) : (
                                    // Range scopes (week/month/custom): aggregate loss across all
                                    // closings in the period — mirrors what /range-report shows.
                                    // Hao hụt thuộc module 'inventory' → đã mở khoá khi tới được đây.
                                    <RangeLossCard
                                        orders={apiOrders}
                                        shiftClosings={apiShiftClosings}
                                        prevShiftClosings={prevShiftClosings}
                                        recipes={recipes}
                                        extraIngredients={extraIngredients}
                                        ingredientUnits={ingredientUnits}
                                        isLocked={false}
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
                 ((view === VIEW_ALL || view === VIEW_INVENTORY) && inventory.isDirty)) && (
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
                            {(view === VIEW_ALL || view === VIEW_INVENTORY) && inventory.isDirty && (
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

            {/* Footer = report view switcher (Dòng tiền / Tồn kho / Lợi nhuận).
                Replaces the old scope bar; scope is now driven entirely by the
                header date control + its presets. */}
            <div className="shrink-0 bg-surface/80 backdrop-blur-md border-t border-border/40 px-4 py-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
                <ReportViewFilter value={view} onChange={setView} isStaff={isStaff} />
            </div>
            <Toast toast={toast} />
        </div>
    )
}
