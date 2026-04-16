import { useState, useEffect } from 'react'
import { Heart, Coffee } from 'lucide-react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate } from 'react-router-dom'
import { calculateProductCost, formatVND } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'

import ReportHeader from '../components/report/ReportHeader'
import ProfitCard from '../components/report/ProfitCard'
import FinanceCards from '../components/report/FinanceCards'
import RevenueChart from '../components/report/RevenueChart'
import HeatmapChart from '../components/report/HeatmapChart'
import MenuEngineering from '../components/report/MenuEngineering'
import ExpenseModal from '../components/report/ExpenseModal'
import { fetchTodayShiftClosing, fetchYesterdayShiftClosing } from '../services/orderService'
import { useAddress } from '../contexts/AddressContext'
import { ingredientLabel, getIngredientUnit } from '../components/recipe/recipeUtils'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const { products, recipes, ingredientCosts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleAddExpense, handleDeleteExpense, handleLoadHistory, fixedCosts, handleAddFixedCost, handleUpdateFixedCost, handleDeleteFixedCost, userRole } = usePOS()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [selectedProductId, setSelectedProductId] = useState('all')
    const [showExpenseListModal, setShowExpenseListModal] = useState(false)
    const { selectedAddress } = useAddress()
    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)

    useEffect(() => {
        if (selectedAddress?.id) {
            fetchTodayShiftClosing(selectedAddress.id).then(setShiftClosing)
            fetchYesterdayShiftClosing(selectedAddress.id).then(setYesterdayClosing)
        }
    }, [selectedAddress?.id])

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

            const cost = calculateProductCost(productId, recipes, ingredientCosts)
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

    // Menu Engineering data
    const menuItems = Array.from(soldProducts).map(productId => {
        const prodDef = products.find(p => p.id === productId)
        const stats = productStats[productId] || { qty: 0, revenue: 0, cost: 0 }
        const profit = stats.revenue - stats.cost
        const margin = stats.revenue > 0 ? (profit / stats.revenue) * 100 : 0
        return { id: productId, name: prodDef ? prodDef.name : 'Unknown', qty: stats.qty, revenue: stats.revenue, cost: stats.cost, profit, margin }
    })

    const medianQty = menuItems.length > 0 ? [...menuItems].sort((a, b) => a.qty - b.qty)[Math.floor(menuItems.length / 2)].qty : 0
    const medianMargin = menuItems.length > 0 ? [...menuItems].sort((a, b) => a.margin - b.margin)[Math.floor(menuItems.length / 2)].margin : 0

    const classifiedItems = menuItems.map(item => {
        const highPop = item.qty >= medianQty
        const highProfit = item.margin >= medianMargin
        let tag, emoji
        if (highPop && highProfit) { tag = 'Star'; emoji = '⭐' }
        else if (highPop && !highProfit) { tag = 'Plow'; emoji = '🐴' }
        else if (!highPop && highProfit) { tag = 'Puzzle'; emoji = '🧩' }
        else { tag = 'Dog'; emoji = '🐶' }
        return { ...item, tag, emoji }
    }).sort((a, b) => b.profit - a.profit)

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate('/history')}
                onEditShiftClosing={() => navigate('/shift-closing')}
            />

            <main className="flex-1 overflow-y-auto px-4 py-6 pb-24 space-y-4 bg-bg">
                {isLoadingHistory ? (
                    <div className="flex flex-col gap-4 animate-pulse">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                            <div className="bg-surface-light rounded-[24px] h-20" />
                        </div>
                        <div className="bg-surface-light rounded-[24px] h-60" />
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
                            onRecipesClick={() => navigate('/recipes')}
                            onExpenseClick={() => navigate('/expenses')}
                        />

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
                            const estimatedConsumption = {}
                            const allOrderItems = [...todayOrders.flatMap(o => (o.order_items || []).map(i => ({ productId: i.product_id, qty: i.quantity || 1 })))]
                            allOrderItems.forEach(({ productId, qty }) => {
                                recipes.filter(r => r.product_id === productId).forEach(r => {
                                    if (!estimatedConsumption[r.ingredient]) estimatedConsumption[r.ingredient] = 0
                                    estimatedConsumption[r.ingredient] += r.amount * qty
                                })
                            })

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

                        {/* Divider */}
                        <div className="flex items-center gap-3 py-1 mt-4 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Phân Tích Kinh Doanh</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full"></div>
                        </div>

                        <RevenueChart lineChartData={lineChartData} />
                        <HeatmapChart hourRange={hourRange} soldProducts={soldProducts} products={products} heatmapData={heatmapData} maxHeatmapQty={maxHeatmapQty} />
                        <MenuEngineering classifiedItems={classifiedItems} />

                        {/* Enhanced Footer */}
                        <div className="flex flex-col items-center justify-center py-8 mt-4 gap-3 relative">
                            <a
                                href="https://github.com/billdeptrai0512"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 text-text-secondary hover:text-primary hover:border-primary/30 hover:bg-primary/5 hover:shadow-[0_0_15px_var(--color-primary-glow)] transition-all duration-300 group z-10"
                            >
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] whitespace-nowrap mt-[1px]">
                                    Developed by billdeptrai0512
                                </span>
                            </a>


                        </div>
                    </div>
                )
                }
            </main >

            {showExpenseListModal && (
                <ExpenseModal
                    todayExpenses={todayExpenses}
                    onClose={() => setShowExpenseListModal(false)}
                    onAddExpense={handleAddExpense}
                    onDeleteExpense={handleDeleteExpense}
                    fixedCosts={fixedCosts}
                    onAddFixedCost={handleAddFixedCost}
                    onUpdateFixedCost={handleUpdateFixedCost}
                    onDeleteFixedCost={handleDeleteFixedCost}
                    userRole={userRole}
                />
            )}
        </div >
    )
}
