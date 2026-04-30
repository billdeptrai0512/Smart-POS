import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { calculateProductCost, formatVND } from '../utils'
import { fetchOrdersByRange, fetchExpensesByRange, fetchShiftClosingsByRange } from '../services/orderService'
import ReportHeader, { getDateRange } from '../components/DailyReportPage/ReportHeader'
import DayPerformanceChart from '../components/DailyReportPage/DayPerformanceChart'
import { Banknote, ArrowRight, MinusCircle, ArrowUp, ArrowDown, TrendingUp, Filter } from 'lucide-react'

const RANGE_LABEL = { week: 'Tuần này', month: 'Tháng này' }

export default function RangeReportPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const range = searchParams.get('range') || 'week'

    const { products, recipes, ingredientCosts, extraIngredients, productExtras } = useProducts()
    const { fixedCosts, handleLoadFixedCosts } = usePOS()
    const { selectedAddress } = useAddress()

    const [selectedProductId, setSelectedProductId] = useState('all')
    const [offset, setOffset] = useState(0)
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

    useEffect(() => {
        if (selectedAddress?.id && fixedCosts.length === 0) handleLoadFixedCosts()
    }, [selectedAddress?.id])

    useEffect(() => {
        if (!selectedAddress?.id) return
        const key = `${selectedAddress.id}_${range}_${offset}`
        const prevKey = `${selectedAddress.id}_${range}_${offset - 1}`

        const cached = fetchCache.current[key]
        const prevCached = fetchCache.current[prevKey]

        if (cached) {
            setOrders(cached.orders)
            setExpenses(cached.expenses)
            setShiftClosings(cached.shiftClosings)
            setPrevOrders(prevCached ? prevCached.orders : [])
            setPrevExpenses(prevCached ? prevCached.expenses : [])
            setPrevShiftClosings(prevCached ? prevCached.shiftClosings : [])
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        const { start, end } = getDateRange(range, offset)
        const { start: prevStart, end: prevEnd } = getDateRange(range, offset - 1)

        Promise.all([
            fetchOrdersByRange(selectedAddress.id, start, end),
            prevCached ? Promise.resolve(prevCached.orders) : fetchOrdersByRange(selectedAddress.id, prevStart, prevEnd),
            fetchExpensesByRange(selectedAddress.id, start, end),
            prevCached ? Promise.resolve(prevCached.expenses) : fetchExpensesByRange(selectedAddress.id, prevStart, prevEnd),
            fetchShiftClosingsByRange(selectedAddress.id, start, end),
            prevCached ? Promise.resolve(prevCached.shiftClosings) : fetchShiftClosingsByRange(selectedAddress.id, prevStart, prevEnd),
        ]).then(([ords, prevOrds, exps, prevExps, closings, prevClosings]) => {
            fetchCache.current[key] = { orders: ords, expenses: exps, shiftClosings: closings }
            if (!prevCached) fetchCache.current[prevKey] = { orders: prevOrds, expenses: prevExps, shiftClosings: prevClosings }
            setOrders(ords)
            setPrevOrders(prevOrds)
            setExpenses(exps)
            setPrevExpenses(prevExps)
            setShiftClosings(closings)
            setPrevShiftClosings(prevClosings)
        }).finally(() => setIsLoading(false))
    }, [selectedAddress?.id, range, offset])

    const { days, start: periodStart, end: periodEnd } = useMemo(() => getDateRange(range, offset), [range, offset])
    const { days: prevDays } = useMemo(() => getDateRange(range, offset - 1), [range, offset])

    const stats = useMemo(() => {
        let totalRevenue = 0, totalCOGS = 0, totalCups = 0
        const productStats = {}
        const soldProducts = new Set()

        const productMap = new Map(products.map(p => [p.id, p]))
        const extraPriceMap = {}, extraNameMap = {}
        Object.values(productExtras || {}).forEach(extras => {
            extras.forEach(e => {
                extraPriceMap[e.id] = e.price || 0
                extraNameMap[e.id] = e.name || e.id
            })
        })
        orders.forEach(o => {
            totalRevenue += o.total

            // totalCups handled inside items loop

            if (o.total_cost > 0) {
                totalCOGS += o.total_cost
            }

            const orderItems = o.order_items || []
            orderItems.forEach(i => {
                const qty = i.quantity || 1
                const productId = i.product_id

                const prodDef = productMap.get(productId)
                if (selectedProductId === 'all') {
                    if (prodDef?.count_as_cup !== false) totalCups += qty
                } else if (selectedProductId === productId) {
                    totalCups += qty
                }
                soldProducts.add(productId)

                let cost = 0;
                if (!(o.total_cost > 0)) {
                    cost = i.unit_cost > 0 ? i.unit_cost : calculateProductCost(productId, [], recipes, extraIngredients, ingredientCosts)
                    totalCOGS += cost * qty
                }

                const basePrice = prodDef?.price || 0
                const extrasPrice = (i.extra_ids || []).reduce((sum, id) => sum + (extraPriceMap[id] || 0), 0)
                const unitRevenue = basePrice + extrasPrice

                const extraNames = (i.extra_ids || []).map(id => extraNameMap[id]).filter(Boolean)
                const variantLabel = extraNames.length > 0
                    ? [...extraNames].sort((a, b) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), 'vi')).join(' + ')
                    : 'Thường'

                if (!productStats[productId]) productStats[productId] = { qty: 0, revenue: 0, cost: 0, variants: {} }
                productStats[productId].qty += qty
                productStats[productId].revenue += unitRevenue * qty
                productStats[productId].cost += cost * qty
                productStats[productId].variants[variantLabel] = (productStats[productId].variants[variantLabel] || 0) + qty
            })
        })

        const cashRevenue = shiftClosings.reduce((s, sc) => s + (sc.actual_cash || 0), 0)
        const transferRevenue = shiftClosings.reduce((s, sc) => s + (sc.actual_transfer || 0), 0)

        const dailyExpense = expenses.filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0)

        const daysToCalculate = days > 0 ? days : 1
        const fixedExpense = (fixedCosts || []).reduce((s, fc) => s + (fc.amount || 0), 0) * daysToCalculate

        const netProfit = totalRevenue - totalCOGS - dailyExpense - fixedExpense

        return { totalRevenue, totalCOGS, totalCups, cashRevenue, transferRevenue, dailyExpense, fixedExpense, netProfit, productStats, soldProducts }
    }, [orders, expenses, shiftClosings, fixedCosts, recipes, extraIngredients, ingredientCosts, productExtras, products, selectedProductId, days])

    const prevStats = useMemo(() => {
        let revenue = 0, cups = 0, totalCOGS = 0
        const prevProductMap = new Map(products.map(p => [p.id, p]))
        prevOrders.forEach(o => {
            revenue += o.total

            if (o.total_cost > 0) {
                totalCOGS += o.total_cost
            }

            const orderItems = o.order_items || []
            orderItems.forEach(i => {
                const qty = i.quantity || 1
                const productId = i.product_id
                if (selectedProductId === 'all') {
                    if (prevProductMap.get(productId)?.count_as_cup !== false) cups += qty
                } else if (selectedProductId === productId) {
                    cups += qty
                }

                if (!(o.total_cost > 0)) {
                    const cost = i.unit_cost > 0 ? i.unit_cost : calculateProductCost(productId, [], recipes, extraIngredients, ingredientCosts)
                    totalCOGS += cost * qty
                }
            })
        })

        const dailyExpense = prevExpenses.filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0)

        const daysToCalculate = prevDays > 0 ? prevDays : 1
        const fixedExpense = (fixedCosts || []).reduce((s, fc) => s + (fc.amount || 0), 0) * daysToCalculate

        const netProfit = revenue - totalCOGS - dailyExpense - fixedExpense

        return { revenue, cups, netProfit }
    }, [prevOrders, prevExpenses, prevShiftClosings, fixedCosts, recipes, extraIngredients, ingredientCosts, selectedProductId, prevDays, products])

    const delta = (curr, prev) => {
        if (!prev) return null
        const pct = Math.round((curr - prev) / prev * 100)
        return pct
    }

    const DeltaBadge = ({ curr, prev }) => {
        const pct = delta(curr, prev)
        if (pct === null) return null
        const up = pct >= 0
        return (
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${up ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
                {up ? '▲' : '▼'} {Math.abs(pct)}%
            </span>
        )
    }

    const avg = (v) => days > 0 ? Math.round(v / days) : v

    const handleNavigateRange = (r) => {
        if (r === 'day') navigate('/daily-report')
        else navigate(`/range-report?range=${r}`)
    }

    const selectedProduct = selectedProductId !== 'all' ? products.find(p => p.id === selectedProductId) : null;
    const singleStats = selectedProduct && stats.productStats?.[selectedProductId] ? stats.productStats[selectedProductId] : null;
    const displayRevenue = singleStats ? singleStats.revenue : stats.totalRevenue;

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate('/daily-report')}
                onEditShiftClosing={() => navigate('/shift-closing')}
                selectedRange={range}
                onNavigateRange={handleNavigateRange}
                offset={offset}
                onOffsetChange={setOffset}
            />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 bg-bg">
                {isLoading ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        <div className="bg-surface-light rounded-[24px] h-[72px]" />
                        <div className="grid grid-cols-2 gap-3">
                            {[...Array(4)].map((_, i) => <div key={i} className="bg-surface-light rounded-[24px] h-[72px]" />)}
                            <div className="col-span-2 bg-surface-light rounded-[24px] h-[72px]" />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 animate-fade-in">
                        {/* Cash / Transfer */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Tiền mặt </h3>
                                <div className="text-[18px] font-bold text-primary tabular-nums">{formatVND((stats.cashRevenue))}</div>
                            </div>
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chuyển khoản </h3>
                                <div className="text-[18px] font-bold text-primary tabular-nums">{formatVND(stats.transferRevenue)}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí ngày</h3>
                                <div className="text-[18px] font-bold text-danger tabular-nums">{formatVND(stats.dailyExpense)}</div>
                            </div>
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Thực nhận </h3>
                                <div className="text-[18px] font-bold text-success tabular-nums">{formatVND(stats.cashRevenue + stats.transferRevenue + stats.dailyExpense)}</div>
                            </div>
                        </div>

                        {/* Summary card */}
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
                                            <Filter size={10} className={selectedProductId !== 'all' ? "text-primary" : ""} />
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
                                        ></div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Performance chart */}
                        <DayPerformanceChart orders={orders} range={range} start={periodStart} end={periodEnd} products={products} />


                        <div className="flex items-center gap-3 py-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tài chính</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                        </div>

                        {/* Finance cards */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Doanh thu</h3>
                                <div className="flex items-center gap-2">
                                    <div className="text-[18px] font-bold text-success tabular-nums">{formatVND(stats.totalRevenue)}</div>
                                </div>
                            </div>
                            <div
                                onClick={() => navigate('/recipes', { state: { from: '/range-report' } })}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Giá vốn</h3>
                                <div className="text-[18px] font-bold text-warning tabular-nums">{formatVND(stats.totalCOGS)}</div>
                            </div>
                            <div
                                onClick={() => navigate('/expenses', { state: { from: '/range-report', tab: 'daily' } })}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí ngày</h3>
                                <div className="text-[18px] font-bold text-danger tabular-nums">{formatVND(stats.dailyExpense)}</div>
                            </div>
                            <div
                                onClick={() => navigate('/expenses', { state: { from: '/range-report', tab: 'fixed' } })}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí cố định</h3>
                                <div className="text-[18px] font-bold text-danger tabular-nums">{formatVND(stats.fixedExpense)}</div>
                            </div>

                            {/* Net profit */}
                            {(() => {
                                const profitDelta = stats.netProfit - prevStats.netProfit
                                const isUpDelta = profitDelta >= 0

                                return (
                                    <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">

                                        <div className="flex flex-col">
                                            <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Lợi nhuận ròng</h3>
                                            <div className={`text-[18px] font-bold tabular-nums ${stats.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {formatVND(stats.netProfit)}
                                            </div>
                                        </div>
                                        {prevStats.netProfit !== undefined && (
                                            <div className="flex flex-col items-center">
                                                <span className="self-center text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">So với {range === 'week' ? 'tuần trước' : 'tháng trước'}</span>
                                                <div className={`px-3 py-1 rounded-xl border ${isUpDelta ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                                                    <span className="text-[12px] font-black tabular-nums leading-none block">
                                                        {formatVND(profitDelta)}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })()}
                        </div>



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
        </div>
    )
}
