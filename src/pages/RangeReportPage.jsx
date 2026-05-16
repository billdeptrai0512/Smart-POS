import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { formatVND } from '../utils'
import { aggregateOrderStats, buildExtraMaps, splitExpenses, sumFixedCosts } from '../utils/reportStats'
import { supabase } from '../lib/supabaseClient'
import { fetchReportByRange } from '../services/orderService'
import ReportHeader, { getDateRange } from '../components/DailyReportPage/ReportHeader'
import DayPerformanceChart from '../components/DailyReportPage/DayPerformanceChart'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import FinancialFlow from '../components/DailyReportPage/FinancialFlow'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW, VIEW_INVENTORY } from '../components/DailyReportPage/ReportViewFilter'
import RangeLossCard from '../components/DailyReportPage/RangeLossCard'
import HistoryFooter from '../components/HistoryPage/HistoryFooter'
import { Filter, Lock } from 'lucide-react'
import { useEntitlement, hasFeature } from '../hooks/useEntitlement'
import UpsellPage from '../components/common/UpsellPage'
import UpsellSheet from '../components/common/UpsellSheet'

const RANGE_LABEL = { week: 'Tuần này', month: 'Tháng này' }

export default function RangeReportPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const location = useLocation()
    const range = searchParams.get('range') || 'week'

    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits } = useProducts()
    const { fixedCosts, handleLoadFixedCosts } = usePOS()
    const { selectedAddress } = useAddress()
    const { isStaff } = useAuth()
    const { activeModules, loading: entitlementLoading } = useEntitlement()

    // ── All hooks must be declared before any conditional return ─────────────
    const [view, setView] = useState(VIEW_ALL)
    const [showLossUpsell, setShowLossUpsell] = useState(false)
    const [selectedProductId, setSelectedProductId] = useState('all')
    const [offset, setOffset] = useState(location.state?.offset ?? 0)
    const [orders, setOrders] = useState([])
    const [prevOrders, setPrevOrders] = useState([])
    const [expenses, setExpenses] = useState([])
    const [prevExpenses, setPrevExpenses] = useState([])
    const [shiftClosings, setShiftClosings] = useState([])
    const [prevShiftClosings, setPrevShiftClosings] = useState([])
    const [isLoading, setIsLoading] = useState(true)

    // Reset offset when the URL `range` changes, by tracking the previous
    // value and updating during render. React 19 handles this without an
    // extra render pass (vs. a useEffect that would cascade into the data-
    // fetching effect below and trigger a stale fetch on the wrong offset).
    const [prevRange, setPrevRange] = useState(range)
    if (range !== prevRange) {
        setPrevRange(range)
        setOffset(0)
    }

    // Cache fetched periods so navigating back doesn't re-fetch
    const fetchCache = useRef({})

    // ── Gate: sau khi tất cả hooks đã khai báo ─────────────────────────────
    // Moved to the bottom to respect Rules of Hooks

    useEffect(() => {
        if (selectedAddress?.id && fixedCosts.length === 0) handleLoadFixedCosts()
    }, [selectedAddress?.id])

    useEffect(() => {
        if (!selectedAddress?.id) return
        if (!entitlementLoading && !hasFeature(activeModules, 'reports')) return // Prevent fetching if not entitled
        const key = `${selectedAddress.id}_${range}_${offset}`
        const cached = fetchCache.current[key]

        if (cached) {
            setOrders(cached.orders)
            setExpenses(cached.expenses)
            setShiftClosings(cached.shiftClosings)
            setPrevOrders(cached.prevOrders)
            setPrevExpenses(cached.prevExpenses)
            setPrevShiftClosings(cached.prevShiftClosings)
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        const { start, end } = getDateRange(range, offset)
        const { start: prevStart, end: prevEnd } = getDateRange(range, offset - 1)

        fetchReportByRange(selectedAddress.id, start.toISOString(), end.toISOString(), prevStart.toISOString(), prevEnd.toISOString())
        .then((data) => {
            const ords = data.target_orders || []
            const exps = data.target_expenses || []
            const closings = data.target_shift_closings || []
            const pOrds = data.prev_orders || []
            const pExps = data.prev_expenses || []
            const pClosings = data.prev_shift_closings || []

            fetchCache.current[key] = {
                orders: ords, expenses: exps, shiftClosings: closings,
                prevOrders: pOrds, prevExpenses: pExps, prevShiftClosings: pClosings
            }

            setOrders(ords)
            setExpenses(exps)
            setShiftClosings(closings)
            setPrevOrders(pOrds)
            setPrevExpenses(pExps)
            setPrevShiftClosings(pClosings)
        })
        .catch((error) => console.error('fetchReportByRange error:', error))
        .finally(() => setIsLoading(false))
    }, [selectedAddress?.id, range, offset, activeModules, entitlementLoading])

    const { days, start: periodStart, end: periodEnd } = useMemo(() => getDateRange(range, offset), [range, offset])
    const { days: prevDays } = useMemo(() => getDateRange(range, offset - 1), [range, offset])

    const stats = useMemo(() => {
        const productMap = new Map(products.map(p => [p.id, p]))
        const { priceMap: extraPriceMap, nameMap: extraNameMap } = buildExtraMaps(productExtras)

        const agg = aggregateOrderStats({
            orders,
            productMap, extraPriceMap, extraNameMap,
            recipes, extraIngredients, ingredientCosts,
            selectedProductId,
            useTotalCostShortcut: true,
        })

        const cashRevenue = shiftClosings.reduce((s, sc) => s + (sc.actual_cash || 0), 0)
        const transferRevenue = shiftClosings.reduce((s, sc) => s + (sc.actual_transfer || 0), 0)

        const { dailyExpense, refillNvl, refillFreeForm, refillTotal } = splitExpenses(expenses)
        const fixedExpense = sumFixedCosts(fixedCosts, days)
        // Vận hành tổng = trong ca + free-form sau ca.
        const operationalExpense = dailyExpense + refillFreeForm
        // P&L = Revenue - COGS - Vận hành - Cố định. NVL không trừ (đã nằm trong COGS).
        const netProfit = agg.totalRevenue - agg.totalCOGS - operationalExpense - fixedExpense

        return {
            totalRevenue: agg.totalRevenue,
            totalCOGS: agg.totalCOGS,
            totalCups: agg.totalCups,
            productStats: agg.productStats,
            soldProducts: agg.soldProducts,
            cashRevenue, transferRevenue,
            dailyExpense, refillTotal, refillNvl, refillFreeForm,
            operationalExpense,
            fixedExpense, netProfit,
        }
    }, [orders, expenses, shiftClosings, fixedCosts, recipes, extraIngredients, ingredientCosts, productExtras, products, selectedProductId, days])

    const prevStats = useMemo(() => {
        const prevProductMap = new Map(products.map(p => [p.id, p]))

        const agg = aggregateOrderStats({
            orders: prevOrders,
            productMap: prevProductMap,
            extraPriceMap: {}, extraNameMap: {},
            recipes, extraIngredients, ingredientCosts,
            selectedProductId,
            useTotalCostShortcut: true,
        })

        const { dailyExpense, refillTotal, refillFreeForm } = splitExpenses(prevExpenses)
        const fixedExpense = sumFixedCosts(fixedCosts, prevDays)
        const operationalExpense = dailyExpense + refillFreeForm
        const netProfit = agg.totalRevenue - agg.totalCOGS - operationalExpense - fixedExpense

        const prevCash = prevShiftClosings.reduce((s, sc) => s + (sc.actual_cash || 0), 0)
        const prevTransfer = prevShiftClosings.reduce((s, sc) => s + (sc.actual_transfer || 0), 0)
        const prevTakeHomeCash = Math.max(0, prevCash - refillTotal)
        const prevRemainingRefill = Math.max(0, refillTotal - prevCash)
        const prevTakeHomeTransfer = Math.max(0, prevTransfer - prevRemainingRefill)
        const takeHome = prevTakeHomeCash + prevTakeHomeTransfer
        const actualTotal = prevCash + prevTransfer + dailyExpense

        return { revenue: agg.totalRevenue, cups: agg.totalCups, netProfit, takeHome, actualTotal }
    }, [prevOrders, prevExpenses, prevShiftClosings, fixedCosts, recipes, extraIngredients, ingredientCosts, selectedProductId, prevDays, products])

    const avg = (v) => days > 0 ? Math.round(v / days) : v

    const handleNavigateRange = (r) => {
        if (r === 'day') navigate('/daily-report')
        else navigate(`/range-report?range=${r}`)
    }

    const selectedProduct = selectedProductId !== 'all' ? products.find(p => p.id === selectedProductId) : null
    const singleStats = selectedProduct && stats.productStats?.[selectedProductId] ? stats.productStats[selectedProductId] : null
    const displayRevenue = singleStats ? singleStats.revenue : stats.totalRevenue

    if (!entitlementLoading && !hasFeature(activeModules, 'reports')) {
        return <UpsellPage required="basic" backTo="/daily-report" />
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate(location.state?.from || '/daily-report')}
                onEditShiftClosing={() => navigate('/shift-closing')}
                selectedRange={range}
                onNavigateRange={handleNavigateRange}
                offset={offset}
                onOffsetChange={setOffset}
            />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-6 space-y-4 bg-bg">
                {isLoading ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        <div className="bg-surface-light rounded-[24px] h-[72px]" />
                        <div className="bg-surface-light rounded-[24px] h-[140px]" />
                        <div className="bg-surface-light rounded-[24px] h-[72px]" />
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-light rounded-[24px] h-[72px]" />)}
                            <div className="col-span-2 bg-surface-light rounded-[24px] h-[72px]" />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">
                        <ReportViewFilter value={view} onChange={setView} />

                        {/* Section 1: Kết quả kinh doanh */}
                        {(view === VIEW_ALL || view === VIEW_PROFIT) && (
                        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 relative overflow-hidden">
                            <div className="flex items-start justify-between">
                                <div className="flex flex-col min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[11px] font-black text-text-secondary uppercase">Tổng cộng</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                                            {stats.totalCups} ly {selectedProduct ? selectedProduct.name.toLowerCase() : ''}
                                        </span>
                                        {!singleStats && <span className="text-[11px] font-medium text-text-secondary">≈ {avg(stats.totalCups)} ly/ngày</span>}
                                    </div>
                                    {singleStats && singleStats.variants && Object.keys(singleStats.variants).length > 0 && (
                                        <div className="flex flex-col gap-0.5 mt-1.5">
                                            {Object.entries(singleStats.variants)
                                                .sort((a, b) => b[1] - a[1])
                                                .map(([label, qty]) => (
                                                    <span key={label} className="text-[11px] text-text-secondary tabular-nums">
                                                        · {label}: <span className="font-black text-text">{qty} ly</span>
                                                    </span>
                                                ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex flex-col items-end shrink-0 ml-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-[11px] font-black text-text-secondary uppercase">Doanh thu</span>
                                        <div className="relative flex items-center justify-center w-5 h-5 bg-surface-light rounded-full border border-border/40 text-text-secondary hover:text-primary transition-colors cursor-pointer">
                                            <Filter size={10} className={selectedProductId !== 'all' ? 'text-primary' : ''} />
                                            <select
                                                value={selectedProductId}
                                                onChange={(e) => setSelectedProductId(e.target.value)}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            >
                                                <option value="all">Tất cả</option>
                                                {products.filter(p => stats.soldProducts.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className={`px-3 py-1 rounded-xl border ${displayRevenue > 0 ? 'bg-success/10 border-success/20 text-success' : 'bg-surface-light border-border/40 text-text-secondary'}`}>
                                        <span className="text-[13px] font-black tabular-nums leading-none block">
                                            {formatVND(displayRevenue || 0)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {singleStats && (
                                <div className="mt-3 pt-3 border-t border-border/30">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[10px] font-black tabular-nums text-primary">
                                            {stats.totalRevenue > 0 ? ((singleStats.revenue / stats.totalRevenue) * 100).toFixed(1) : 0}%
                                        </span>
                                        <span className="text-[10px] font-bold text-primary">100%</span>
                                    </div>
                                    <div className="h-[6px] rounded-full bg-border/30 overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-primary transition-all duration-300"
                                            style={{ width: `${stats.totalRevenue > 0 ? Math.max(2, (singleStats.revenue / stats.totalRevenue) * 100) : 0}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {(view === VIEW_ALL || view === VIEW_PROFIT) && (
                            <DayPerformanceChart orders={orders} range={range} start={periodStart} end={periodEnd} products={products} />
                        )}

                        {(view === VIEW_ALL || view === VIEW_PROFIT) && !isStaff && (
                            <>
                                <FinanceCards
                                    totalRevenue={stats.totalRevenue}
                                    totalCOGS={stats.totalCOGS}
                                    dailyExpense={stats.operationalExpense}
                                    refillNvl={stats.refillNvl}
                                    refillFreeForm={stats.refillFreeForm}
                                    fixedExpense={stats.fixedExpense}
                                    netProfit={stats.netProfit}
                                    onRecipesClick={() => navigate('/recipes', { state: { from: '/range-report' } })}
                                    onDailyExpenseClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'daily', expensesToView: expenses, isReadOnly: true } })}
                                    onRefillNvlClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'nvl', expensesToView: expenses, isReadOnly: true } })}
                                    onRefillFreeFormClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'after', expensesToView: expenses, isReadOnly: true } })}
                                    onFixedExpenseClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'fixed', isReadOnly: true } })}
                                    yesterdayNetProfit={prevStats.netProfit}
                                    compareLabel={`So với ${range === 'week' ? 'tuần trước' : 'tháng trước'}`}
                                />
                            </>
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
                                    cash={stats.cashRevenue}
                                    transfer={stats.transferRevenue}
                                    dailyExpense={stats.dailyExpense}
                                    onDailyExpenseClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'daily', expensesToView: expenses, isReadOnly: true } })}
                                />

                                <FinancialFlow
                                    actualCash={stats.cashRevenue}
                                    actualTransfer={stats.transferRevenue}
                                    dailyExpense={stats.dailyExpense}
                                    refillTotal={stats.refillTotal}
                                    refillNvl={stats.refillNvl}
                                    refillFreeForm={stats.refillFreeForm}
                                    yesterdayActualTotal={prevStats.actualTotal}
                                    yesterdayTakeHome={prevStats.takeHome}
                                    compareLabel={`So với ${range === 'week' ? 'tuần trước' : 'tháng trước'}`}
                                    onDailyExpenseClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'daily', expensesToView: expenses, isReadOnly: true } })}
                                    onRefillClick={() => navigate('/history', { state: { from: `/range-report?range=${range}`, tab: 'expense', filter: 'nvl', expensesToView: expenses, isReadOnly: true } })}
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

                                <RangeLossCard
                                    orders={orders}
                                    shiftClosings={shiftClosings}
                                    prevShiftClosings={prevShiftClosings}
                                    recipes={recipes}
                                    extraIngredients={extraIngredients}
                                    ingredientUnits={ingredientUnits}
                                    isLocked={!hasFeature(activeModules, 'lossAudit')}
                                    onUnlockClick={() => setShowLossUpsell(true)}
                                />
                            </>
                        )}

                        <UpsellSheet
                            open={showLossUpsell}
                            onClose={() => setShowLossUpsell(false)}
                            required="pro"
                        />




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
                    // Hand-off current scope+offset to /history so the date window survives the tab swap
                    navigate('/history', {
                        replace: true,
                        state: {
                            from: location.state?.from || '/addresses',
                            tab: tab === 'orders' ? 'orders' : 'expense',
                            scope: range,
                            offset,
                        },
                    })
                }}
            />
        </div>
    )
}
