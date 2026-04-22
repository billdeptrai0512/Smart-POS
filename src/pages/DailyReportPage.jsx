import { useState, useEffect } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import ReportHeader from '../components/DailyReportPage/ReportHeader'
import ReportSettingsSheet from '../components/DailyReportPage/ReportSettingsSheet'
import ProfitCard from '../components/DailyReportPage/ProfitCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import RevenueChart from '../components/DailyReportPage/RevenueChart'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'

import { fetchTodayShiftClosing, fetchYesterdayShiftClosing, fetchYesterdayOrders, fetchYesterdayExpenses } from '../services/orderService'
import { useAddress } from '../contexts/AddressContext'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts, extraIngredients, productExtras } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, fixedCosts } = usePOS()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [selectedProductId, setSelectedProductId] = useState('all')
    const [showSettings, setShowSettings] = useState(false)
    const { selectedAddress } = useAddress()
    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)
    const [yesterdayOrders, setYesterdayOrders] = useState([])
    const [yesterdayExpensesData, setYesterdayExpensesData] = useState([])
    const [isAsyncReady, setIsAsyncReady] = useState(false)

    useEffect(() => {
        if (selectedAddress?.id) {
            setIsAsyncReady(false)
            Promise.all([
                fetchTodayShiftClosing(selectedAddress.id).then(setShiftClosing),
                fetchYesterdayShiftClosing(selectedAddress.id).then(setYesterdayClosing),
                fetchYesterdayOrders(selectedAddress.id).then(setYesterdayOrders),
                fetchYesterdayExpenses(selectedAddress.id).then(setYesterdayExpensesData),
            ]).finally(() => setIsAsyncReady(true))
        }
    }, [selectedAddress?.id])

    const isReady = !isLoadingHistory && isAsyncReady

    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

    // Flat maps extraId → price/name for quick lookup on online orders
    const extraPriceMap = {}, extraNameMap = {}
    Object.values(productExtras || {}).forEach(extras => {
        extras.forEach(e => {
            extraPriceMap[e.id] = e.price || 0
            extraNameMap[e.id] = e.name || e.id
        })
    })

    let totalRevenue = 0, totalCOGS = 0, totalCups = 0
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
            const prodDef = products.find(p => p.id === productId)
            const name = prodDef?.name || (isOffline ? i.name : i.products?.name) || '?'
            if (!hourlyOrders[hour]) hourlyOrders[hour] = {}
            hourlyOrders[hour][name] = (hourlyOrders[hour][name] || 0) + qty

            if (selectedProductId === 'all' || selectedProductId === productId) totalCups += qty
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

    todayOrders.forEach(o => processOrder(o, false))
    offlineToday.forEach(o => processOrder(o, true))

    const dailyExpense = (todayExpenses || []).filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0)
    const fixedExpense = (fixedCosts || []).reduce((s, fc) => s + (fc.amount || 0), 0)
    const netProfit = totalRevenue - totalCOGS - dailyExpense - fixedExpense

    let yesterdayRevenue = 0, yesterdayCOGS = 0
    yesterdayOrders.forEach(o => {
        yesterdayRevenue += o.total
        if (o.total_cost > 0) {
            yesterdayCOGS += o.total_cost
        } else {
            (o.order_items || []).forEach(i => {
                const qty = i.quantity || 1
                const cost = i.unit_cost > 0 ? i.unit_cost : calculateProductCost(i.product_id, [], recipes, extraIngredients, ingredientCosts)
                yesterdayCOGS += cost * qty
            })
        }
    })
    const yesterdayNetProfit = (yesterdayRevenue - yesterdayCOGS)
        - yesterdayExpensesData.filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0)
        - yesterdayExpensesData.filter(e => e.is_fixed).reduce((s, e) => s + e.amount, 0)

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

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate('/history')}
                onOpenSettings={() => setShowSettings(true)}
                subtitle="Hôm nay"
            />
            <ReportSettingsSheet
                open={showSettings}
                onClose={() => setShowSettings(false)}
                selectedRange="day"
                onNavigateRange={(range) => {
                    setShowSettings(false)
                    if (range !== 'day') navigate(`/range-report?range=${range}`)
                }}
                onEditShiftClosing={() => { setShowSettings(false); navigate('/shift-closing') }}
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
                            shiftClosing={shiftClosing}
                            productStats={productStats}
                        />

                        <RevenueChart lineChartData={lineChartData} />

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

                        <InventoryRefillCard
                            shiftClosing={shiftClosing}
                            yesterdayClosing={yesterdayClosing}
                            todayOrders={todayOrders}
                            offlineToday={offlineToday}
                            recipes={recipes}
                            extraIngredients={extraIngredients}
                            selectedAddress={selectedAddress}
                            products={products}
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
