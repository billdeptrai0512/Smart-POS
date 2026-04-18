import { useState, useEffect } from 'react'
import { Heart, Coffee } from 'lucide-react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { calculateProductCost } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { calculateEstimatedConsumption } from '../utils/inventory'
import ReportHeader from '../components/DailyReportPage/ReportHeader'
import ProfitCard from '../components/DailyReportPage/ProfitCard'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import RevenueChart from '../components/DailyReportPage/RevenueChart'
import HeatmapChart from '../components/DailyReportPage/HeatmapChart'

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

            // Hybrid COGS: use snapshot if available, fallback to dynamic calc
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
        lineChartData.push({ hour: `${h}h`, revenue: cumulative })
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

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 my-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Kết quả kinh doanh</span>
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

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 mt-4 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Thống kê</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                        </div>

                        <RevenueChart lineChartData={lineChartData} />
                        <HeatmapChart hourRange={hourRange} soldProducts={soldProducts} products={products} heatmapData={heatmapData} maxHeatmapQty={maxHeatmapQty} />

                        {/* Inventory Analysis — only when shift closing has inventory */}
                        {shiftClosing?.inventory_report?.length > 0 && (() => {
                            // Build opening stock from yesterday
                            const openingMap = {}
                            if (yesterdayClosing?.inventory_report) {
                                yesterdayClosing.inventory_report.forEach(item => {
                                    openingMap[item.ingredient] = item.remaining || 0
                                })
                            }

                            // Calculate estimated consumption
                            const allOrderItems = []
                            todayOrders.forEach(o => {
                                (o.order_items || []).forEach(i => allOrderItems.push({ productId: i.product_id, qty: i.quantity || 1, extras: i.extras || [] }))
                            })
                            offlineToday.forEach(o => {
                                (o.cart || o.orderItems || []).forEach(i => allOrderItems.push({ productId: i.productId, qty: i.quantity || 1, extras: i.extras || [] }))
                            })
                            const estimatedConsumption = calculateEstimatedConsumption(allOrderItems, recipes, extraIngredients)

                            return (
                                <>
                                    {/* Divider */}
                                    <div className="flex items-center gap-3 py-1 mt-4 px-4">
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                                        <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tồn kho</span>
                                        <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                                    </div><div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm">
                                        {/* Headers */}
                                        <div className="flex items-center gap-1 mb-2">
                                            <span className="flex-1 text-[12px] font-black text-text-dim uppercase ">Nguyên liệu</span>
                                            <span className="w-[60px] text-[10px] font-black text-text-dim uppercase text-center">Lý thuyết</span>
                                            <span className="w-[60px] text-[10px] font-black text-text-dim uppercase text-center">Thực tế</span>
                                            <span className="w-[60px] text-[10px] font-black text-text-dim uppercase text-center">Lệch</span>
                                        </div>
                                        <div className="space-y-1">
                                            {shiftClosing.inventory_report.map(item => {
                                                // === HƯỚNG DẪN CÁCH TÍNH TỒN KHO CỤ THỂ ===
                                                // 1. opening (Tồn đầu): Số lượng còn lại từ báo cáo chốt ca ngày hôm trước.
                                                // 2. restock (Nhập kho): Lượng nguyên liệu mới nhập vô trong vòng ca hôm nay.
                                                // 3. used (Tiêu hao dự kiến): Tính tự động bằng cách lấy (Số lượng ly đã bán x Định lượng của từng nguyên liệu trong Menu công thức).
                                                const opening = openingMap[item.ingredient]
                                                const restock = item.restock || 0
                                                const used = Math.round((estimatedConsumption[item.ingredient] || 0) * 10) / 10
                                                const hasOpening = opening !== undefined

                                                // 4. theoretical (Lý thuyết): Là số máy tự tính ra trên hệ thống. 
                                                //    Công thức: Tồn lý thuyết = Tồn đầu (opening) + Nhập kho (restock) - Tiêu hao dự kiến (used).
                                                const theoretical = hasOpening ? Math.round((opening + restock - used) * 10) / 10 : null

                                                // 5. actual (Thực tế): Số lượng do nhân viên tự kiểm đếm (nhập bằng tay lúc chốt ca).
                                                const actual = item.remaining || 0

                                                // 6. diff (Lệch): Sự khác biệt giữa Thực Tế và Lý Thuyết = (actual - theoretical)
                                                //    * Nếu diff < 0 (Hụt): Thực tế ít hơn máy tính -> Do pha tay bị lố, rớt đổ, hoặc hao hụt tự nhiên.
                                                //    * Nếu diff > 0 (Dư): Thực tế nhiều hơn máy tính -> Do pha thiếu định mức nguyên liệu, hoặc khách kén không lấy.
                                                // ============================================
                                                const diff = theoretical !== null ? Math.round((actual - theoretical) * 10) / 10 : null

                                                // ingredientCosts is an object mapping ingredient -> cost, no unit info here
                                                const unit = getIngredientUnit(item.ingredient)

                                                let diffText = '—'
                                                let diffColor = 'text-text-dim'
                                                if (diff !== null) {
                                                    if (diff < 0) {
                                                        diffText = `Hụt ${Math.abs(diff)}${unit}`
                                                        diffColor = 'text-danger'
                                                    } else if (diff > 0) {
                                                        diffText = `Dư ${diff}${unit}`
                                                        diffColor = 'text-warning' // Use warning for leftovers since it could mean inconsistent quality
                                                    } else {
                                                        diffText = 'Khớp'
                                                        diffColor = 'text-success'
                                                    }
                                                }

                                                return (
                                                    <div key={item.ingredient} className="flex items-center gap-1 py-1 border-b border-border/20 last:border-0">
                                                        <span className="flex-1 text-[11px] font-bold text-text truncate">{ingredientLabel(item.ingredient)}</span>
                                                        <span className="w-[60px] text-[11px] font-bold text-text text-center tabular-nums">{theoretical !== null ? theoretical : '—'}</span>

                                                        <span className="w-[60px] text-[11px] font-bold text-text text-center tabular-nums">{actual}</span>
                                                        <span className={`w-[60px] text-[10px] font-black text-center tabular-nums ${diffColor}`}>
                                                            {diffText}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </>

                            )
                        })()}



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
