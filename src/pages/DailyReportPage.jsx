import { useState, useEffect, useMemo, useRef } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses, sumFixedCosts } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchReportByDate } from '../services/orderService'
import ReportHeader from '../components/DailyReportPage/ReportHeader'
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

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, fixedCosts } = usePOS()
    const { isStaff } = useAuth()
    const { activeModules, loading: entitlementLoading } = useEntitlement()

    // ── All hooks unconditional (Rules of Hooks) ──────────────────────────────
    const [view, setView] = useState(VIEW_ALL)
    const [selectedProductId, setSelectedProductId] = useState('all')
    const { selectedAddress } = useAddress()
    const initialDate = location.state?.initialDate || null
    const [customDate, setCustomDate] = useState(initialDate)
    const [debouncedDate, setDebouncedDate] = useState(initialDate)
    const debounceRef = useRef(null)
    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)
    const [yesterdayOrders, setYesterdayOrders] = useState([])
    const [yesterdayExpensesData, setYesterdayExpensesData] = useState([])
    const [isAsyncReady, setIsAsyncReady] = useState(false)
    const [apiOrders, setApiOrders] = useState([])
    const [apiExpenses, setApiExpenses] = useState([])

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleCustomDateChange = (date) => {
        setCustomDate(date)
        clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => setDebouncedDate(date), 400)
    }

    // Computed display data
    const displayOrders = debouncedDate ? apiOrders : todayOrders
    const displayExpenses = debouncedDate ? apiExpenses : todayExpenses

    useEffect(() => {
        if (!selectedAddress?.id) return

        setIsAsyncReady(false)
        if (!debouncedDate) {
            // Today view: 1 RPC instead of 4 calls
            fetchDailyReportContext(selectedAddress.id)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setYesterdayOrders(data?.yesterday_orders || [])
                    setYesterdayExpensesData(data?.yesterday_expenses || [])
                })
                .catch((error) => console.error('fetchDailyReportContext error:', error))
                .finally(() => setIsAsyncReady(true))
        } else {
            // Custom date view: 1 RPC instead of 6 calls
            fetchReportByDate(selectedAddress.id, debouncedDate)
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
        }
    }, [selectedAddress?.id, debouncedDate])

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => buildExtraMaps(productExtras), [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalCOGS, productStats, soldProducts, lineChartData, offlineToday } = useMemo(() => {
        const pending = customDate ? [] : getPendingOrders()
        const todayStr = new Date().toDateString()
        const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

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
    }, [displayOrders, productMap, extraMaps, recipes, extraIngredients, ingredientCosts, customDate])

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

    const yesterdayActualTotal = useMemo(() => {
        if (!yesterdayClosing) return null
        const yCash = yesterdayClosing.actual_cash || 0
        const yTransfer = yesterdayClosing.actual_transfer || 0
        const yDailyExpense = yesterdayExpensesData.filter(e => !e.is_fixed && !e.is_refill).reduce((s, e) => s + e.amount, 0)
        return yCash + yTransfer + yDailyExpense
    }, [yesterdayClosing, yesterdayExpensesData])

    const yesterdayTakeHome = useMemo(() => {
        if (!yesterdayClosing) return null
        const yCash = yesterdayClosing.actual_cash || 0
        const yTransfer = yesterdayClosing.actual_transfer || 0
        const yRefill = yesterdayExpensesData.filter(e => e.is_refill).reduce((s, e) => s + e.amount, 0)

        const yTakeHomeCash = Math.max(0, yCash - yRefill)
        const yRemainingRefill = Math.max(0, yRefill - yCash)
        const yTakeHomeTransfer = Math.max(0, yTransfer - yRemainingRefill)

        return yTakeHomeCash + yTakeHomeTransfer
    }, [yesterdayClosing, yesterdayExpensesData])

    if (!entitlementLoading && !hasFeature(activeModules, 'reports')) {
        return <UpsellPage required="basic" backTo="/history" />
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate(backTo)}
                onEditShiftClosing={() => navigate('/shift-closing')}
                selectedRange="day"
                onNavigateRange={(range) => {
                    if (range !== 'day') navigate(`/range-report?range=${range}`)
                }}
                customDate={customDate}
                onCustomDateChange={handleCustomDateChange}
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

                        {(view === VIEW_ALL || view === VIEW_PROFIT) && (
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
                        )}

                        {(view === VIEW_ALL || view === VIEW_PROFIT) && !isStaff && (
                            <FinanceCards
                                totalRevenue={totalRevenue}
                                totalCOGS={totalCOGS}
                                dailyExpense={operationalExpense}
                                refillNvl={refillNvl}
                                refillFreeForm={refillFreeForm}
                                fixedExpense={fixedExpense}
                                netProfit={netProfit}
                                onRecipesClick={() => navigate('/recipes', { state: { from: '/daily-report' } })}
                                onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'daily', expensesToView: customDate ? apiExpenses : undefined, isReadOnly: !!customDate } })}
                                onRefillNvlClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'nvl', expensesToView: customDate ? apiExpenses : undefined, isReadOnly: !!customDate } })}
                                onRefillFreeFormClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'after', expensesToView: customDate ? apiExpenses : undefined, isReadOnly: !!customDate } })}
                                onFixedExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'fixed', isReadOnly: !!customDate } })}
                                yesterdayNetProfit={yesterdayNetProfit}
                            />
                        )}

                        {(view === VIEW_ALL || view === VIEW_CASHFLOW) && (
                            <>
                                {view === VIEW_ALL && (
                                    <div className="flex items-center gap-3 py-1 my-1 px-4">
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Dòng tiền</span>
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                    </div>
                                )}

                                <CashFlowCard
                                    shiftClosing={shiftClosing}
                                    dailyExpense={dailyExpense}
                                    onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'daily', expensesToView: customDate ? apiExpenses : undefined, isReadOnly: !!customDate } })}
                                />

                                <FinancialFlow
                                    actualCash={shiftClosing?.actual_cash || 0}
                                    actualTransfer={shiftClosing?.actual_transfer || 0}
                                    dailyExpense={dailyExpense}
                                    refillTotal={refillTotal}
                                    refillNvl={refillNvl}
                                    refillFreeForm={refillFreeForm}
                                    yesterdayActualTotal={yesterdayActualTotal}
                                    yesterdayTakeHome={yesterdayTakeHome}
                                    onDailyExpenseClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'daily', expensesToView: customDate ? apiExpenses : undefined, isReadOnly: !!customDate } })}
                                    onRefillClick={() => navigate('/history', { state: { from: '/daily-report', tab: 'expense', filter: 'nvl', expensesToView: customDate ? apiExpenses : undefined, isReadOnly: !!customDate } })}
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
                                    offlineToday={customDate ? [] : offlineToday}
                                    recipes={recipes}
                                    extraIngredients={extraIngredients}
                                    selectedAddress={selectedAddress}
                                    products={products}
                                    productExtras={productExtras}
                                    ingredientUnits={ingredientUnits}
                                    isPastDate={!!customDate && new Date(customDate).toDateString() !== new Date().toDateString()}
                                    canAccessAudit={hasFeature(activeModules, 'lossAudit')}
                                />
                            </>
                        )}


                        {/* only for manager  */}


                        <div className="flex flex-col items-center justify-center py-8 mt-4">
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

            <HistoryFooter
                activeTab="report"
                onSelect={(tab) => {
                    if (tab === 'report') return
                    // Tab-switch within shared dashboard → replace to preserve entry point in history stack
                    navigate('/history', { replace: true, state: { from: backTo, tab: tab === 'orders' ? 'orders' : 'expense' } })
                }}
            />
        </div>
    )
}
