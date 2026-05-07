import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { usePOS } from '../contexts/POSContext'
import { fetchIngredientRestockHistory, fetchIngredientStocks } from '../services/orderService'
import { ingredientLabel, getIngredientUnit } from '../components/common/recipeUtils'
import { formatVND } from '../utils'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import RestockModal from '../components/IngredientManagementPage/RestockModal'
import { processIngredientRestock } from '../services/orderService'

export default function IngredientDetailPage() {
    const navigate = useNavigate()
    const { ingredientKey } = useParams()
    const { ingredientCosts, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin, profile } = useAuth()
    const { refreshTodayExpenses } = usePOS()
    const canEdit = isManager || isAdmin

    const [history, setHistory] = useState([])
    const [loading, setLoading] = useState(true)
    const [stockData, setStockData] = useState(null)
    const [showRestock, setShowRestock] = useState(false)

    // Month navigation
    const [monthOffset, setMonthOffset] = useState(0)
    const targetMonth = useMemo(() => {
        const d = new Date()
        d.setMonth(d.getMonth() + monthOffset)
        return d
    }, [monthOffset])

    const monthLabel = targetMonth.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })

    const { fromDate, toDate } = useMemo(() => {
        const from = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1)
        const to = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59)
        return { fromDate: from.toISOString(), toDate: to.toISOString() }
    }, [targetMonth])

    const unit = getIngredientUnit(ingredientKey, ingredientUnits[ingredientKey])
    const cost = ingredientCosts[ingredientKey] || 0

    // Load history & stock
    useEffect(() => {
        if (!selectedAddress?.id || !ingredientKey) return
        setLoading(true)
        Promise.all([
            fetchIngredientRestockHistory(selectedAddress.id, ingredientKey, fromDate, toDate),
            fetchIngredientStocks(selectedAddress.id)
        ]).then(([hist, stocks]) => {
            setHistory(hist)
            const row = stocks.find(s => s.ingredient === ingredientKey)
            setStockData(row)
        }).finally(() => setLoading(false))
    }, [selectedAddress?.id, ingredientKey, fromDate, toDate])

    // Summary
    const summary = useMemo(() => {
        let totalSpent = 0, totalQty = 0
        history.forEach(e => {
            totalSpent += e.amount || 0
            totalQty += e.metadata?.qty || 0
        })
        const avgPrice = totalQty > 0 ? Math.round(totalSpent / totalQty) : 0
        return { totalSpent, totalQty, avgPrice, count: history.length }
    }, [history])

    const handleRestock = async ({ ingredient, qty, totalCost }) => {
        const result = await processIngredientRestock(
            selectedAddress?.id, ingredient, qty, totalCost, profile?.name
        )
        // Refresh data: history, stocks, products, AND todayExpenses (RPC bypass handleAddExpense)
        const [hist, stocks] = await Promise.all([
            fetchIngredientRestockHistory(selectedAddress.id, ingredientKey, fromDate, toDate),
            fetchIngredientStocks(selectedAddress.id),
            refreshTodayExpenses?.()
        ])
        setHistory(hist)
        setStockData(stocks.find(s => s.ingredient === ingredientKey))
        refreshProducts?.()
        return result
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm px-4">
                <div className="flex items-center gap-3 mb-3">
                    <button
                        onClick={() => navigate('/ingredients')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>
                    <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-[18px] font-black text-text leading-tight truncate">
                            {ingredientLabel(ingredientKey)}
                        </span>
                        <span className="text-[12px] font-bold text-text-secondary">
                            Tồn: {stockData ? `${Math.round(stockData.current_stock * 10) / 10} ${unit}` : '—'}
                            {canEdit && ` · Giá vốn: ${formatVND(cost)}/${unit}`}
                        </span>
                    </div>
                </div>

                {/* Month picker */}
                <div className="flex items-center justify-between bg-surface-light rounded-[12px] px-1 py-1">
                    <button
                        onClick={() => setMonthOffset(p => p - 1)}
                        className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <span className="text-[13px] font-black text-text capitalize">{monthLabel}</span>
                    <button
                        onClick={() => setMonthOffset(p => Math.min(0, p + 1))}
                        disabled={monthOffset >= 0}
                        className="w-9 h-9 flex items-center justify-center rounded-[10px] text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all disabled:opacity-20"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto px-4 py-4 pb-32 bg-bg space-y-4">
                {/* Summary card */}
                {!loading && summary.count > 0 && (
                    <div className="bg-surface rounded-[16px] border border-border/60 p-4 grid grid-cols-3 gap-3">
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Tổng chi</span>
                            <span className="text-[16px] font-black text-danger tabular-nums mt-1">{formatVND(summary.totalSpent)}</span>
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">Tổng nhập</span>
                            <span className="text-[16px] font-black text-text tabular-nums mt-1">{summary.totalQty} {unit}</span>
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black text-text-secondary uppercase tracking-wider">TB/đơn vị</span>
                            <span className="text-[16px] font-black text-primary tabular-nums mt-1">{formatVND(summary.avgPrice)}</span>
                        </div>
                    </div>
                )}

                {/* History list */}
                {loading ? (
                    <div className="flex flex-col gap-3 animate-pulse">
                        {[1, 2, 3].map(i => <div key={i} className="bg-surface-light rounded-[14px] h-16" />)}
                    </div>
                ) : history.length === 0 ? (
                    <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-[14px] border border-border/40">
                        Chưa có lịch sử nhập kho trong {monthLabel}.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {history.map(entry => {
                            const d = new Date(entry.created_at)
                            const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
                            const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                            const qty = entry.metadata?.qty || 0
                            const unitPrice = qty > 0 ? Math.round(entry.amount / qty) : 0

                            return (
                                <div key={entry.id} className="bg-surface rounded-[14px] border border-border/60 p-3 flex items-center gap-3">
                                    {/* Date badge */}
                                    <div className="flex flex-col items-center shrink-0 w-12">
                                        <span className="text-[13px] font-black text-text tabular-nums">{dateStr}</span>
                                        <span className="text-[10px] font-bold text-text-dim tabular-nums">{timeStr}</span>
                                    </div>

                                    {/* Details */}
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-[13px] font-bold text-text">
                                            +{qty} {unit}
                                        </span>
                                        <span className="text-[11px] text-text-secondary truncate">
                                            {entry.staff_name || 'Không rõ'} · {formatVND(unitPrice)}/{unit}
                                        </span>
                                    </div>

                                    {/* Amount */}
                                    <span className="text-[14px] font-black text-danger tabular-nums shrink-0">
                                        -{formatVND(entry.amount)}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </main>

            {/* Footer: Restock button */}
            <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-surface border-t border-border/60 z-50">
                <button
                    onClick={() => setShowRestock(true)}
                    className="w-full py-3.5 rounded-[14px] bg-primary text-white text-[15px] font-black uppercase tracking-wide hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98] transition-all shadow-lg shadow-primary/20"
                >
                    + Nhập kho {ingredientLabel(ingredientKey)}
                </button>
            </div>

            {/* Restock Modal */}
            {showRestock && (
                <RestockModal
                    ingredient={ingredientKey}
                    unit={unit}
                    onClose={() => setShowRestock(false)}
                    onConfirm={handleRestock}
                />
            )}
        </div>
    )
}
