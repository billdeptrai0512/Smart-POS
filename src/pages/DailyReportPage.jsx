import { useState, useEffect, useMemo } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost, formatVNDInput, parseVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses, sumFixedCosts } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchReportByDate, fetchReportByRange } from '../services/orderService'
import { useShiftClosingSave } from '../hooks/useShiftClosingSave'
import { useShiftInventoryState } from '../hooks/useShiftInventoryState'
import { calculateEstimatedConsumption, calculateConsumptionBreakdown } from '../utils/inventory'
import { startOfDayVN, dateStringVN, isSameDayVN } from '../utils/dateVN'
import { calcRangeWithPrev, offsetFromISO, dayCustomDateOf } from '../utils/rangeCalc'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import SalesCard from '../components/DailyReportPage/SalesCard'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'
import InventoryReportCard from '../components/ShiftClosingPage/InventoryReportCard'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY } from '../components/DailyReportPage/ReportViewFilter'
import HistoryFooter from '../components/HistoryPage/HistoryFooter'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useEntitlement, hasFeature } from '../hooks/useEntitlement'
import UpsellPage from '../components/common/UpsellPage'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, fixedCosts } = usePOS()
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

    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)
    const [yesterdayOrders, setYesterdayOrders] = useState([])
    const [yesterdayExpensesData, setYesterdayExpensesData] = useState([])
    const [isAsyncReady, setIsAsyncReady] = useState(false)
    const [apiOrders, setApiOrders] = useState([])
    const [apiExpenses, setApiExpenses] = useState([])
    const [apiShiftClosings, setApiShiftClosings] = useState([])

    // Inline cash/transfer editor (today scope only). Pre-fills from shiftClosing when
    // it loads; dirty flag controls when the Lưu button appears.
    const [cashInput, setCashInput] = useState('')
    const [transferInput, setTransferInput] = useState('')
    const [cashDirty, setCashDirty] = useState(false)
    const { save: saveShiftClosing, isSaving: isSavingShift } = useShiftClosingSave(selectedAddress?.id)

    // Inventory editor (today scope only). All input state + warehouse fetch live in
    // the hook so DailyReportPage stays focused on render orchestration.
    const inventory = useShiftInventoryState(selectedAddress?.id, selectedAddress?.ingredient_sort_order)
    const [inventoryTab, setInventoryTab] = useState('report') // 'report' | 'refill'

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Range calculations
    const { rangeStart, rangeEnd, prevStart, prevEnd } = useMemo(() => {
        const { start, end, prevStart: pStart, prevEnd: pEnd } = calcRangeWithPrev(scope, offset, customRange)
        return { rangeStart: start, rangeEnd: end, prevStart: pStart, prevEnd: pEnd }
    }, [scope, offset, customRange])

    const isTodayScope = scope === 'day' && offset === 0

    // Pre-fill cash/transfer inputs from the existing shift_closing (if any).
    // Resets the dirty flag — user's mid-edit values are preserved across re-renders
    // because this only fires when the underlying shiftClosing rows actually change.
    useEffect(() => {
        if (!isTodayScope) return
        setCashInput(shiftClosing?.actual_cash != null ? formatVNDInput(shiftClosing.actual_cash) : '')
        setTransferInput(shiftClosing?.actual_transfer != null ? formatVNDInput(shiftClosing.actual_transfer) : '')
        setCashDirty(false)
    }, [isTodayScope, shiftClosing?.id, shiftClosing?.actual_cash, shiftClosing?.actual_transfer])

    // Computed display data
    const displayOrders = isTodayScope ? todayOrders : apiOrders
    const displayExpenses = isTodayScope ? todayExpenses : apiExpenses

    useEffect(() => {
        if (!selectedAddress?.id) return

        setIsAsyncReady(false)
        if (isTodayScope) {
            fetchDailyReportContext(selectedAddress.id)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setYesterdayOrders(data?.yesterday_orders || [])
                    setYesterdayExpensesData(data?.yesterday_expenses || [])
                })
                .catch((error) => showError(error, 'Tải báo cáo hôm nay'))
                .finally(() => setIsAsyncReady(true))
        } else if (scope === 'day') {
            const targetDateStr = dateStringVN(rangeStart)
            fetchReportByDate(selectedAddress.id, targetDateStr)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setYesterdayOrders(data?.yesterday_orders || [])
                    setYesterdayExpensesData(data?.yesterday_expenses || [])
                    setApiOrders(data?.target_orders || [])
                    setApiExpenses(data?.target_expenses || [])
                })
                .catch((error) => showError(error, `Tải báo cáo ngày ${targetDateStr}`))
                .finally(() => setIsAsyncReady(true))
        } else {
            // Range scopes
            fetchReportByRange(selectedAddress.id, rangeStart.toISOString(), rangeEnd.toISOString(), prevStart.toISOString(), prevEnd.toISOString())
                .then((data) => {
                    setApiOrders(data?.target_orders || [])
                    setApiExpenses(data?.target_expenses || [])
                    setApiShiftClosings(data?.target_shift_closings || [])
                    setYesterdayOrders(data?.prev_orders || [])
                    setYesterdayExpensesData(data?.prev_expenses || [])

                    if (data?.target_shift_closings?.length) {
                        setShiftClosing(data.target_shift_closings[data.target_shift_closings.length - 1])
                    } else {
                        setShiftClosing(null)
                    }
                })
                .catch((error) => showError(error, 'Tải báo cáo theo khoảng'))
                .finally(() => setIsAsyncReady(true))
        }
    }, [selectedAddress?.id, scope, offset, rangeStart, rangeEnd, isTodayScope])

    // Header date logic
    const todayISO = dateStringVN(new Date())
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
    const fixedExpense = useMemo(() => sumFixedCosts(fixedCosts), [fixedCosts])
    // Vận hành tổng = trong ca + free-form sau ca (sau ca vẫn là vận hành, không phải NVL).
    const operationalExpense = dailyExpense + refillFreeForm
    // P&L = Revenue - COGS - Vận hành - Cố định. NVL không trừ (đã nằm trong COGS).
    const netProfit = totalRevenue - totalCOGS - operationalExpense - fixedExpense

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
        const nonFixedSum = yesterdayExpensesData.filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0)
        const fixedSum = yesterdayExpensesData.filter(e => e.is_fixed).reduce((s, e) => s + e.amount, 0)
        return (rev - cogs) - nonFixedSum - fixedSum
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
                onFixedCostError: (err) => showError(err, 'Ghi chi phí cố định vào ca'),
            })
            showToast('Đã lưu báo cáo tồn kho', 'success')
            inventory.setIsDirty(false)
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
                onFixedCostError: (err) => showError(err, 'Ghi chi phí cố định vào ca'),
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
                        <ReportViewFilter value={view} onChange={setView} />

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
                                dailyExpense={dailyExpense}
                                refillNvl={refillNvl}
                                refillFreeForm={refillFreeForm}
                                fixedExpense={fixedExpense}
                                netProfit={netProfit}
                                onRecipesClick={() => navigate('/recipes', { state: { from: '/daily-report' } })}
                                onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'operation', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                onRefillNvlClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'nvl', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                onRefillFreeFormClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'after', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                onFixedExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'fixed', isReadOnly: scope !== 'day' || offset !== 0 } })}
                                yesterdayNetProfit={yesterdayNetProfit}
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
                                onCashChange={(v) => { setCashInput(formatVNDInput(v)); setCashDirty(true) }}
                                onTransferChange={(v) => { setTransferInput(formatVNDInput(v)); setCashDirty(true) }}
                                onSave={handleSaveCashflow}
                                isSaving={isSavingShift}
                                hasChanges={cashDirty}
                                onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'operation', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
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
                                        <div className="flex p-1 bg-surface-light rounded-[12px] gap-1 w-full">
                                            <button
                                                onClick={() => setInventoryTab('report')}
                                                className={`flex-1 py-1.5 rounded-[10px] uppercase text-[13px] font-bold transition-all ${inventoryTab === 'report' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary/70 hover:text-text'}`}
                                            >
                                                Báo cáo
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
                                                ingredientToProduct={ingredientToProduct}
                                                consumptionBreakdown={consumptionBreakdown}
                                                canUnlock={!isStaff}
                                                isSubmitting={isSavingShift}
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
                                ) : (
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

            {/* FAB: Lưu báo cáo — floating bottom-right, shown only when inventory has unsaved edits.
                Same shape/spacing as HistoryPage's "+ Add expense" FAB. */}
            {isTodayScope && (view === VIEW_ALL || view === VIEW_INVENTORY) && inventoryTab === 'report' && inventory.isDirty && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40">
                    <div className="flex justify-end px-4 mb-[72px] pointer-events-auto">
                        <button
                            onClick={handleSaveInventory}
                            disabled={isSavingShift}
                            className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSavingShift ? 'Đang lưu...' : 'Lưu báo cáo'}
                        </button>
                    </div>
                </div>
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
        </div>
    )
}
