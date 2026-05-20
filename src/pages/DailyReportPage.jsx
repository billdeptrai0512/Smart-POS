import { useState, useEffect, useMemo, useRef } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses, sumFixedCosts } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchReportByDate, fetchReportByRange } from '../services/orderService'
import { startOfDayVN, endOfDayVN, dateStringVN, isSameDayVN } from '../utils/dateVN'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import { getDateRange } from '../components/DailyReportPage/ReportHeader'
import SalesCard from '../components/DailyReportPage/SalesCard'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'
import FinancialFlow from '../components/DailyReportPage/FinancialFlow'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY } from '../components/DailyReportPage/ReportViewFilter'
import HistoryFooter from '../components/HistoryPage/HistoryFooter'
import { supabase } from '../lib/supabaseClient'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useEntitlement, hasFeature } from '../hooks/useEntitlement'
import UpsellPage from '../components/common/UpsellPage'

// Use dateStringVN so YYYY-MM-DD always reflects Vietnam local date
const getLocalISO = (date = new Date()) => dateStringVN(date)

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, fixedCosts } = usePOS()
    const { isStaff } = useAuth()
    const { activeModules, loading: entitlementLoading } = useEntitlement()

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
    const [prevShiftClosings, setPrevShiftClosings] = useState([])

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Range calculations
    const { rangeStart, rangeEnd, prevStart, prevEnd } = useMemo(() => {
        if (scope === 'day') {
            const target = new Date()
            target.setDate(target.getDate() + offset)
            const start = startOfDayVN(target)
            const end = endOfDayVN(target)
            const pStart = new Date(start)
            pStart.setDate(pStart.getDate() - 1)
            const pEnd = new Date(end)
            pEnd.setDate(pEnd.getDate() - 1)
            return { rangeStart: start, rangeEnd: end, prevStart: pStart, prevEnd: pEnd }
        }
        if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
            const start = new Date(`${customRange.startISO}T00:00:00+07:00`)
            const end = new Date(`${customRange.endISO}T23:59:59.999+07:00`)
            const diff = end.getTime() - start.getTime()
            const pStart = new Date(start.getTime() - diff - 86400000)
            const pEnd = new Date(end.getTime() - diff - 86400000)
            return { rangeStart: start, rangeEnd: end, prevStart: pStart, prevEnd: pEnd }
        }
        const { start, end } = getDateRange(scope, offset)
        const { start: pStart, end: pEnd } = getDateRange(scope, offset - 1)
        return { rangeStart: start, rangeEnd: end, prevStart: pStart, prevEnd: pEnd }
    }, [scope, offset, customRange])

    const isTodayScope = scope === 'day' && offset === 0

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
                .catch((error) => console.error('fetchDailyReportContext error:', error))
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
                .catch((error) => console.error('fetchReportByDate error:', error))
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
                    setPrevShiftClosings(data?.prev_shift_closings || [])

                    if (data?.target_shift_closings?.length) {
                        setShiftClosing(data.target_shift_closings[data.target_shift_closings.length - 1])
                    } else {
                        setShiftClosing(null)
                    }
                })
                .catch((error) => console.error('fetchReportByRange error:', error))
                .finally(() => setIsAsyncReady(true))
        }
    }, [selectedAddress?.id, scope, offset, rangeStart, rangeEnd, isTodayScope])

    // Header date logic
    const todayISO = dateStringVN(new Date())
    const dayCustomDate = useMemo(() => {
        if (scope !== 'day' || offset === 0) return null
        const d = new Date()
        d.setDate(d.getDate() + offset)
        return dateStringVN(d)
    }, [scope, offset])

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
        const target = new Date(`${iso}T00:00:00+07:00`)
        const today = startOfDayVN()
        setOffset(Math.round((target - today) / 86400000))
    }
    const handleScopeChange = (next) => { setOffset(0); setScope(next); setHasManualPick(false) }
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
        const todayStr = dateStringVN()
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

    const { dailyExpense, refillTotal, refillNvl, refillFreeForm } = useMemo(
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

    const yesterdayActualCash = scope === 'day' ? (yesterdayClosing?.actual_cash || 0) : prevShiftClosings.reduce((sum, s) => sum + (s.actual_cash || 0), 0)
    const yesterdayActualTransfer = scope === 'day' ? (yesterdayClosing?.actual_transfer || 0) : prevShiftClosings.reduce((sum, s) => sum + (s.actual_transfer || 0), 0)

    const yestTotalRefill = yesterdayExpensesData.filter(e => e.is_refill).reduce((s, e) => s + e.amount, 0)
    const yestOpsExpense = yesterdayExpensesData.filter(e => !e.is_fixed && !e.is_refill).reduce((s, e) => s + e.amount, 0)

    const yesterdayTakeHome = yesterdayActualCash + yesterdayActualTransfer - yestTotalRefill
    const yesterdayActualTotal = yesterdayActualCash + yesterdayActualTransfer + yestOpsExpense

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
                        <ReportViewFilter value={view} onChange={setView} isStaff={isStaff} />

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
                            <>
                                <CashFlowCard
                                    shiftClosing={shiftClosing}
                                    dailyExpense={dailyExpense}
                                    cash={scope === 'day' ? (shiftClosing?.actual_cash || 0) : apiShiftClosings.reduce((sum, s) => sum + (s.actual_cash || 0), 0)}
                                    transfer={scope === 'day' ? (shiftClosing?.actual_transfer || 0) : apiShiftClosings.reduce((sum, s) => sum + (s.actual_transfer || 0), 0)}
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

                                <FinancialFlow
                                    actualCash={scope === 'day' ? (shiftClosing?.actual_cash || 0) : apiShiftClosings.reduce((sum, s) => sum + (s.actual_cash || 0), 0)}
                                    actualTransfer={scope === 'day' ? (shiftClosing?.actual_transfer || 0) : apiShiftClosings.reduce((sum, s) => sum + (s.actual_transfer || 0), 0)}
                                    dailyExpense={dailyExpense}
                                    refillTotal={refillTotal}
                                    refillNvl={refillNvl}
                                    refillFreeForm={refillFreeForm}
                                    yesterdayActualTotal={yesterdayActualTotal}
                                    yesterdayTakeHome={yesterdayTakeHome}
                                    onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'operation', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                    onRefillClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'nvl', expensesToView: scope !== 'day' || offset !== 0 ? apiExpenses : undefined, isReadOnly: scope !== 'day' || offset !== 0 } })}
                                />
                            </>
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

                                <InventoryRefillCard
                                    shiftClosing={shiftClosing}
                                    yesterdayClosing={yesterdayClosing}
                                    todayOrders={displayOrders}
                                    offlineToday={scope !== 'day' || offset !== 0 ? [] : offlineToday}
                                    recipes={recipes}
                                    extraIngredients={extraIngredients}
                                    selectedAddress={selectedAddress}
                                    products={products}
                                    productExtras={productExtras}
                                    ingredientUnits={ingredientUnits}
                                    isPastDate={scope !== 'day' || offset !== 0}
                                    canAccessAudit={hasFeature(activeModules, 'lossAudit')}
                                />
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

            {/* FAB: Cập nhật báo cáo */}
            {(view === VIEW_CASHFLOW || view === VIEW_INVENTORY) && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40">
                    <div className="flex justify-end px-4 mb-[72px] pointer-events-auto">
                        <button
                            onClick={() => navigate('/shift-closing')}
                            className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm"
                        >
                            Cập nhật báo cáo
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
        </div>
    )
}
