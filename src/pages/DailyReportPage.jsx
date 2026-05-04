import { useState, useEffect, useMemo } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import ReportHeader from '../components/DailyReportPage/ReportHeader'
import ProfitCard from '../components/DailyReportPage/ProfitCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import RevenueChart from '../components/DailyReportPage/RevenueChart'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'
import {
    fetchTodayShiftClosing, fetchYesterdayShiftClosing, fetchYesterdayOrders, fetchYesterdayExpenses,
    fetchOrdersByRange, fetchExpensesByRange, fetchShiftClosingsByRange
} from '../services/orderService'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, fixedCosts } = usePOS()
    const { isStaff } = useAuth()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [selectedProductId, setSelectedProductId] = useState('all')
    const { selectedAddress } = useAddress()
    const [customDate, setCustomDate] = useState(null)
    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)
    const [yesterdayOrders, setYesterdayOrders] = useState([])
    const [yesterdayExpensesData, setYesterdayExpensesData] = useState([])
    const [isAsyncReady, setIsAsyncReady] = useState(false)
    const [apiOrders, setApiOrders] = useState([])
    const [apiExpenses, setApiExpenses] = useState([])

    // Computed display data
    const displayOrders = customDate ? apiOrders : todayOrders
    const displayExpenses = customDate ? apiExpenses : todayExpenses

    useEffect(() => {
        if (!selectedAddress?.id) return

        setIsAsyncReady(false)
        if (!customDate) {
            Promise.all([
                fetchTodayShiftClosing(selectedAddress.id).then(setShiftClosing),
                fetchYesterdayShiftClosing(selectedAddress.id).then(setYesterdayClosing),
                fetchYesterdayOrders(selectedAddress.id).then(setYesterdayOrders),
                fetchYesterdayExpenses(selectedAddress.id).then(setYesterdayExpensesData),
            ]).finally(() => setIsAsyncReady(true))
        } else {
            // customDate is a string 'YYYY-MM-DD'
            const targetDate = new Date(customDate)
            targetDate.setHours(0, 0, 0, 0)
            const targetEnd = new Date(targetDate)
            targetEnd.setHours(23, 59, 59, 999)

            const prevDate = new Date(targetDate)
            prevDate.setDate(prevDate.getDate() - 1)
            const prevEnd = new Date(prevDate)
            prevEnd.setHours(23, 59, 59, 999)

            Promise.all([
                fetchShiftClosingsByRange(selectedAddress.id, targetDate, targetEnd).then(res => setShiftClosing(res[0] || null)),
                fetchShiftClosingsByRange(selectedAddress.id, prevDate, prevEnd).then(res => setYesterdayClosing(res[0] || null)),
                fetchOrdersByRange(selectedAddress.id, prevDate, prevEnd).then(setYesterdayOrders),
                fetchExpensesByRange(selectedAddress.id, prevDate, prevEnd).then(setYesterdayExpensesData),
                fetchOrdersByRange(selectedAddress.id, targetDate, targetEnd).then(setApiOrders),
                fetchExpensesByRange(selectedAddress.id, targetDate, targetEnd).then(setApiExpenses)
            ]).finally(() => setIsAsyncReady(true))
        }
    }, [selectedAddress?.id, customDate])

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => {
        const priceMap = {}, nameMap = {}
        Object.values(productExtras || {}).forEach(extras => {
            extras.forEach(e => {
                priceMap[e.id] = e.price || 0
                nameMap[e.id] = e.name || e.id
            })
        })
        return { priceMap, nameMap }
    }, [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalCOGS, productStats, soldProducts, lineChartData, offlineToday } = useMemo(() => {
        const { priceMap: extraPriceMap, nameMap: extraNameMap } = extraMaps

        const pending = customDate ? [] : getPendingOrders()
        const todayStr = new Date().toDateString()
        const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

        let totalRevenue = 0, totalCOGS = 0
        const hourlyRevenue = {}, hourlyOrders = {}, productStats = {}
        const activeHours = new Set(), soldProducts = new Set()

        const processOrder = (o, isOffline) => {
            const createdAt = isOffline ? o.createdAt : o.created_at
            if (!createdAt) return
            const d = new Date(createdAt)
            const hour = d.getHours()
            activeHours.add(hour)
            hourlyRevenue[hour] = (hourlyRevenue[hour] || 0) + o.total
            totalRevenue += o.total

            const items = isOffline ? (o.cart || o.orderItems || []) : (o.order_items || [])
            items.forEach(i => {
                const productId = isOffline ? i.productId : i.product_id
                const qty = i.quantity || 1
                const prodDef = productMap.get(productId)
                const name = prodDef?.name || (isOffline ? i.name : i.products?.name) || '?'
                if (!hourlyOrders[hour]) hourlyOrders[hour] = {}
                hourlyOrders[hour][name] = (hourlyOrders[hour][name] || 0) + qty

                soldProducts.add(productId)

                const snapshotCost = isOffline ? (i.unitCost || 0) : (i.unit_cost || 0)
                const cost = snapshotCost > 0
                    ? snapshotCost
                    : calculateProductCost(productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                totalCOGS += cost * qty

                const basePrice = prodDef?.price || 0
                const extrasPrice = isOffline
                    ? (i.extras || []).reduce((sum, e) => sum + (e.price || 0), 0)
                    : (i.extra_ids || []).reduce((sum, id) => sum + (extraPriceMap[id] || 0), 0)
                const unitRevenue = basePrice + extrasPrice

                const extraNames = isOffline
                    ? (i.extras || []).map(e => e.name).filter(Boolean)
                    : (i.extra_ids || []).map(id => extraNameMap[id]).filter(Boolean)
                const variantLabel = extraNames.length > 0
                    ? [...extraNames].sort((a, b) => a.trim().toLowerCase().localeCompare(b.trim().toLowerCase(), 'vi')).join(' + ')
                    : 'Thường'

                if (!productStats[productId]) productStats[productId] = { qty: 0, revenue: 0, cost: 0, variants: {} }
                productStats[productId].qty += qty
                productStats[productId].revenue += unitRevenue * qty
                productStats[productId].cost += cost * qty
                productStats[productId].variants[variantLabel] = (productStats[productId].variants[variantLabel] || 0) + qty
            })
        }

        displayOrders.filter(o => !o.deleted_at).forEach(o => processOrder(o, false))
        offlineToday.forEach(o => processOrder(o, true))

        const hourRange = []
        if (activeHours.size > 0) {
            const minH = Math.min(...activeHours), maxH = Math.max(...activeHours)
            for (let h = minH; h <= maxH; h++) hourRange.push(h)
        }
        let cumulative = 0
        const lineChartData = hourRange.map(h => {
            cumulative += (hourlyRevenue[h] || 0)
            const items = Object.entries(hourlyOrders[h] || {}).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty)
            return { hour: `${h}h`, revenue: cumulative, hourRevenue: hourlyRevenue[h] || 0, items }
        })

        return { totalRevenue, totalCOGS, productStats, soldProducts, lineChartData, offlineToday }
    }, [displayOrders, productMap, extraMaps, recipes, extraIngredients, ingredientCosts, customDate])

    // totalCups separated: only reruns when filter or orders change, not on other UI state
    // When 'all' filter, products with count_as_cup=false are excluded; when filtering a specific product, always count it.
    const totalCups = useMemo(() => {
        let cups = 0
        const isExcluded = (pid) => productMap.get(pid)?.count_as_cup === false
        displayOrders.filter(o => !o.deleted_at).forEach(o => {
            ; (o.order_items || []).forEach(i => {
                if (selectedProductId === 'all') {
                    if (!isExcluded(i.product_id)) cups += i.quantity || 1
                } else if (selectedProductId === i.product_id) {
                    cups += i.quantity || 1
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

    const dailyExpense = useMemo(() =>
        (todayExpenses || []).filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0),
        [todayExpenses]
    )
    const fixedExpense = useMemo(() =>
        (fixedCosts || []).reduce((s, fc) => s + (fc.amount || 0), 0),
        [fixedCosts]
    )
    const netProfit = totalRevenue - totalCOGS - dailyExpense - fixedExpense

    const yesterdayNetProfit = useMemo(() => {
        let rev = 0, cogs = 0
        yesterdayOrders.filter(o => !o.deleted_at).forEach(o => {
            rev += o.total
            if (o.total_cost > 0) {
                cogs += o.total_cost
            } else {
                ; (o.order_items || []).forEach(i => {
                    const qty = i.quantity || 1
                    const cost = i.unit_cost > 0 ? i.unit_cost : calculateProductCost(i.product_id, [], recipes, extraIngredients, ingredientCosts)
                    cogs += cost * qty
                })
            }
        })
        return (rev - cogs)
            - yesterdayExpensesData.filter(e => !e.is_fixed && !e.is_refill).reduce((s, e) => s + e.amount, 0)
            - yesterdayExpensesData.filter(e => e.is_fixed).reduce((s, e) => s + e.amount, 0)
    }, [yesterdayOrders, yesterdayExpensesData, recipes, extraIngredients, ingredientCosts])

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate('/history')}
                onEditShiftClosing={() => navigate('/shift-closing')}
                selectedRange="day"
                onNavigateRange={(range) => {
                    if (range !== 'day') navigate(`/range-report?range=${range}`)
                }}
                customDate={customDate}
                onCustomDateChange={setCustomDate}
            />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 bg-bg">
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
                        <ProfitCard
                            totalCups={totalCups}
                            selectedProductId={selectedProductId}
                            onFilterChange={setSelectedProductId}
                            products={products}
                            soldProducts={soldProducts}
                            totalRevenue={totalRevenue}
                            dailyExpense={dailyExpense}
                            refillCash={refillCash}
                            refillTransfer={refillTransfer}
                            shiftClosing={shiftClosing}
                            productStats={productStats}
                        />

                        <RevenueChart lineChartData={lineChartData} />

                        {/* only for manage */}
                        {!isStaff && (
                            <>
                                <div className="flex items-center gap-3 py-1 my-1 px-4">
                                    <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tài chính</span>
                                    <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                </div>

                                <FinanceCards
                                    totalRevenue={totalRevenue}
                                    totalCOGS={totalCOGS}
                                    dailyExpense={dailyExpense}
                                    fixedExpense={fixedExpense}
                                    netProfit={netProfit}
                                    onRecipesClick={() => navigate('/recipes', { state: { from: '/daily-report' } })}
                                    onDailyExpenseClick={() => navigate('/expenses', { state: { from: '/daily-report', tab: 'daily' } })}
                                    onFixedExpenseClick={() => navigate('/expenses', { state: { from: '/daily-report', tab: 'fixed' } })}
                                    yesterdayNetProfit={yesterdayNetProfit}
                                />
                            </>
                        )}
                        {/* only for manager  */}

                        <InventoryRefillCard
                            shiftClosing={shiftClosing}
                            yesterdayClosing={yesterdayClosing}
                            todayOrders={todayOrders}
                            offlineToday={offlineToday}
                            recipes={recipes}
                            extraIngredients={extraIngredients}
                            selectedAddress={selectedAddress}
                            products={products}
                            productExtras={productExtras}
                            ingredientUnits={ingredientUnits}
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
        </div>
    )
}
