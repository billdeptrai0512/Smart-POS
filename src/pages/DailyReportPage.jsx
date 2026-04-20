import { useState, useEffect } from 'react'
import { Heart, Coffee } from 'lucide-react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import ReportHeader from '../components/DailyReportPage/ReportHeader'
import ProfitCard from '../components/DailyReportPage/ProfitCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import RevenueChart from '../components/DailyReportPage/RevenueChart'
import HeatmapChart from '../components/DailyReportPage/HeatmapChart'
import InventoryRefillCard from '../components/DailyReportPage/InventoryRefillCard'

import { fetchTodayShiftClosing, fetchYesterdayShiftClosing, fetchYesterdayOrders, fetchYesterdayExpenses } from '../services/orderService'
import { useAddress } from '../contexts/AddressContext'
import { ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts, extraIngredients } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, fixedCosts } = usePOS()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [selectedProductId, setSelectedProductId] = useState('all')
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

    // Calculate metrics
    let totalRevenue = 0
    let totalCOGS = 0
    let totalCups = 0

    const heatmapData = {}
    const hourlyRevenue = {}
    const hourlyOrders = {}
    const productStats = {}
    const activeHours = new Set()
    const soldProducts = new Set()
    let maxHeatmapQty = 0

    const processOrder = (o, isOffline) => {
        const createdAt = isOffline ? o.createdAt : o.created_at
        if (!createdAt) return

        const d = new Date(createdAt)
        const hour = d.getHours()
        activeHours.add(hour)

        hourlyRevenue[hour] = (hourlyRevenue[hour] || 0) + o.total
        totalRevenue += o.total

        const items = isOffline ? (o.cart || o.orderItems || []) : (o.order_items || [])

        // Aggregate items per hour for dot tooltip
        items.forEach(i => {
            const productId = isOffline ? i.productId : i.product_id
            const qty = i.quantity || 1
            const prodDef = products.find(p => p.id === productId)
            const name = prodDef?.name || (isOffline ? i.name : i.products?.name) || '?'
            if (!hourlyOrders[hour]) hourlyOrders[hour] = {}
            hourlyOrders[hour][name] = (hourlyOrders[hour][name] || 0) + qty
        })

        items.forEach(i => {
            const productId = isOffline ? i.productId : i.product_id
            const qty = i.quantity || 1

            if (selectedProductId === 'all' || selectedProductId === productId) {
                totalCups += qty
            }

            soldProducts.add(productId)

            if (!heatmapData[productId]) heatmapData[productId] = {}
            heatmapData[productId][hour] = (heatmapData[productId][hour] || 0) + qty
            if (heatmapData[productId][hour] > maxHeatmapQty) maxHeatmapQty = heatmapData[productId][hour]

            const snapshotCost = isOffline ? (i.unitCost || 0) : (i.unit_cost || 0)
            const cost = snapshotCost > 0
                ? snapshotCost
                : calculateProductCost(productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
            totalCOGS += cost * qty

            const prodDef = products.find(p => p.id === productId)
            const price = prodDef ? prodDef.price : 0

            if (!productStats[productId]) productStats[productId] = { qty: 0, revenue: 0, cost: 0 }
            productStats[productId].qty += qty
            productStats[productId].revenue += price * qty
            productStats[productId].cost += cost * qty
        })
    }

    todayOrders.forEach(o => processOrder(o, false))
    offlineToday.forEach(o => processOrder(o, true))

    const dailyExpense = (todayExpenses || []).filter(e => !e.is_fixed).reduce((sum, e) => sum + e.amount, 0)
    const fixedExpense = (fixedCosts || []).reduce((sum, fc) => sum + (fc.amount || 0), 0)
    const totalExpense = dailyExpense + fixedExpense
    const grossProfit = totalRevenue - totalCOGS
    const netProfit = grossProfit - totalExpense

    // Compute yesterday's profit for comparison
    let yesterdayRevenue = 0
    let yesterdayCOGS = 0
    yesterdayOrders.forEach(o => {
        yesterdayRevenue += o.total
        // Hybrid: prefer total_cost snapshot, fallback to dynamic calc
        if (o.total_cost > 0) {
            yesterdayCOGS += o.total_cost
        } else {
            const items = o.order_items || []
            items.forEach(i => {
                const qty = i.quantity || 1
                const snapshotCost = i.unit_cost || 0
                const cost = snapshotCost > 0
                    ? snapshotCost
                    : calculateProductCost(i.product_id, i.extras || [], recipes, extraIngredients, ingredientCosts)
                yesterdayCOGS += cost * qty
            })
        }
    })
    const yesterdayDailyExpense = yesterdayExpensesData.filter(e => !e.is_fixed).reduce((sum, e) => sum + e.amount, 0)
    const yesterdayFixedExpense = yesterdayExpensesData.filter(e => e.is_fixed).reduce((sum, e) => sum + e.amount, 0)
    const yesterdayNetProfit = (yesterdayRevenue - yesterdayCOGS) - (yesterdayDailyExpense + yesterdayFixedExpense)

    // Build Chart Arrays
    const hourRange = []
    if (activeHours.size > 0) {
        const minH = Math.min(...Array.from(activeHours))
        const maxH = Math.max(...Array.from(activeHours))
        for (let h = minH; h <= maxH; h++) hourRange.push(h)
    }

    const lineChartData = []
    let cumulative = 0
    for (const h of hourRange) {
        cumulative += (hourlyRevenue[h] || 0)
        const hourItems = Object.entries(hourlyOrders[h] || {}).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty)
        lineChartData.push({ hour: `${h}h`, revenue: cumulative, hourRevenue: hourlyRevenue[h] || 0, items: hourItems })
    }



    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate('/history')}
                onEditShiftClosing={() => navigate('/shift-closing')}
            />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 bg-bg">
                {!isReady ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        {/* ProfitCard skeleton */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-[62px]" />
                        {/* Divider skeleton */}
                        <div className="flex items-center gap-3 py-1 my-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/40 rounded-full" />
                            <div className="h-3 w-32 bg-surface-light rounded" />
                            <div className="flex-1 h-[1px] bg-border/40 rounded-full" />
                        </div>
                        {/* FinanceCards skeleton */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="bg-surface-light rounded-[24px] h-[72px]" />
                            <div className="col-span-2 bg-surface-light rounded-[24px] h-[72px]" />
                        </div>
                        {/* Chart skeleton */}
                        <div className="bg-surface-light rounded-[24px] h-52" />
                        <div className="bg-surface-light rounded-[24px] h-40" />
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

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 my-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tài chính</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
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

                        {/* Inventory Analysis */}
                        <InventoryRefillCard
                            shiftClosing={shiftClosing}
                            yesterdayClosing={yesterdayClosing}
                            todayOrders={todayOrders}
                            offlineToday={offlineToday}
                            recipes={recipes}
                            extraIngredients={extraIngredients}
                            selectedAddress={selectedAddress}
                        />

                        {/* Enhanced Footer */}
                        <div className="flex flex-col items-center justify-center py-8 mt-4 gap-3 relative">
                            <a
                                href="https://github.com/billdeptrai0512"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-[#c8956c]/40 hover:bg-[#c8956c]/5 hover:shadow-[0_0_15px_rgba(200,149,108,0.15)] transition-all duration-300 group z-10"
                            >
                                <span
                                    className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap mt-[1px] bg-clip-text text-transparent"
                                    style={{ backgroundImage: 'linear-gradient(135deg, #c8956c, #e2b77d, #d4a06a, #b8865a)' }}
                                >
                                    Developed by billdeptrai0512
                                </span>
                            </a>
                        </div>
                    </div>
                )
                }
            </main >
        </div >
    )
}
