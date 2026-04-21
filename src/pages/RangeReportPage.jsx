import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { calculateProductCost, formatVND } from '../utils'
import { fetchOrdersByRange, fetchExpensesByRange } from '../services/orderService'
import ReportHeader from '../components/DailyReportPage/ReportHeader'
import ReportSettingsSheet from '../components/DailyReportPage/ReportSettingsSheet'
import { Banknote, ArrowRight, MinusCircle, ArrowUp, ArrowDown, TrendingUp } from 'lucide-react'

const RANGE_CONFIG = {
    week: { label: 'Tuần này', getDates: () => { const now = new Date(); const day = now.getDay(); const diff = (day + 6) % 7; const start = new Date(now); start.setDate(now.getDate() - diff); start.setHours(0, 0, 0, 0); const end = new Date(now); end.setHours(23, 59, 59, 999); return { start, end, days: diff + 1 } } },
    month: { label: 'Tháng này', getDates: () => { const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0); const end = new Date(now); end.setHours(23, 59, 59, 999); return { start, end, days: now.getDate() } } },
}

export default function RangeReportPage() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const range = searchParams.get('range') || 'week'
    const config = RANGE_CONFIG[range] || RANGE_CONFIG.week

    const { products, recipes, ingredientCosts, extraIngredients } = useProducts()
    const { fixedCosts } = usePOS()
    const { selectedAddress } = useAddress()

    const [showSettings, setShowSettings] = useState(false)
    const [orders, setOrders] = useState([])
    const [expenses, setExpenses] = useState([])
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        if (!selectedAddress?.id) return
        setIsLoading(true)
        const { start, end } = config.getDates()
        Promise.all([
            fetchOrdersByRange(selectedAddress.id, start, end).then(setOrders),
            fetchExpensesByRange(selectedAddress.id, start, end).then(setExpenses),
        ]).finally(() => setIsLoading(false))
    }, [selectedAddress?.id, range])

    const { days } = useMemo(() => config.getDates(), [range])

    const stats = useMemo(() => {
        let totalRevenue = 0, totalCOGS = 0, totalCups = 0
        let cashRevenue = 0, transferRevenue = 0

        orders.forEach(o => {
            totalRevenue += o.total
            if (o.payment_method === 'transfer') transferRevenue += o.total
            else cashRevenue += o.total

            totalCups += (o.order_items || []).reduce((s, i) => s + (i.quantity || 1), 0)

            if (o.total_cost > 0) {
                totalCOGS += o.total_cost
            } else {
                (o.order_items || []).forEach(i => {
                    const qty = i.quantity || 1
                    const cost = i.unit_cost > 0 ? i.unit_cost : calculateProductCost(i.product_id, [], recipes, extraIngredients, ingredientCosts)
                    totalCOGS += cost * qty
                })
            }
        })

        const dailyExpense = expenses.filter(e => !e.is_fixed).reduce((s, e) => s + e.amount, 0)
        const fixedExpense = (fixedCosts || []).reduce((s, fc) => s + (fc.amount || 0), 0) * days
        const netProfit = totalRevenue - totalCOGS - dailyExpense - fixedExpense

        return { totalRevenue, totalCOGS, totalCups, cashRevenue, transferRevenue, dailyExpense, fixedExpense, netProfit }
    }, [orders, expenses, fixedCosts, days, recipes, extraIngredients, ingredientCosts])

    const avg = (v) => days > 0 ? Math.round(v / days) : v

    const handleNavigateRange = (r) => {
        setShowSettings(false)
        if (r === 'day') navigate('/daily-report')
        else navigate(`/range-report?range=${r}`)
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <ReportHeader
                onBack={() => navigate('/daily-report')}
                onOpenSettings={() => setShowSettings(true)}
                subtitle={config.label}
            />
            <ReportSettingsSheet
                open={showSettings}
                onClose={() => setShowSettings(false)}
                selectedRange={range}
                onNavigateRange={handleNavigateRange}
                onEditShiftClosing={() => { setShowSettings(false); navigate('/shift-closing') }}
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
                        {/* Summary card */}
                        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 relative overflow-hidden">
                            <div className="absolute top-3 right-3 text-primary/10">
                                <TrendingUp size={36} />
                            </div>
                            <span className="text-[11px] font-black text-text-secondary uppercase">Tổng {days} ngày</span>
                            <div className="flex items-end gap-3 mt-1">
                                <span className="text-[22px] font-bold text-primary tabular-nums leading-none">{stats.totalCups} ly</span>
                                <span className="text-[13px] font-medium text-text-secondary mb-0.5">≈ {avg(stats.totalCups)} ly/ngày</span>
                            </div>
                        </div>

                        {/* Cash / Transfer */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Tiền mặt <span className="normal-case font-medium text-[11px]">/ngày</span></h3>
                                <div className="text-[18px] font-bold text-primary tabular-nums">{formatVND(avg(stats.cashRevenue))}</div>
                            </div>
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center">
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chuyển khoản <span className="normal-case font-medium text-[11px]">/ngày</span></h3>
                                <div className="text-[18px] font-bold text-primary tabular-nums">{formatVND(avg(stats.transferRevenue))}</div>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 py-1 px-4">
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                            <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Tài chính</span>
                            <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                        </div>

                        {/* Finance cards */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                                <div className="absolute top-3 right-3 text-success/20"><Banknote size={36} /></div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Doanh thu <span className="normal-case font-medium text-[11px]">/ngày</span></h3>
                                <div className="text-[18px] font-bold text-success tabular-nums">{formatVND(avg(stats.totalRevenue))}</div>
                            </div>
                            <div
                                onClick={() => navigate('/recipes', { state: { from: '/range-report' } })}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <div className="absolute top-3 right-3 text-warning/30"><ArrowRight size={36} /></div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Giá vốn <span className="normal-case font-medium text-[11px]">/ngày</span></h3>
                                <div className="text-[18px] font-bold text-warning tabular-nums">- {formatVND(avg(stats.totalCOGS))}</div>
                            </div>
                            <div
                                onClick={() => navigate('/expenses', { state: { from: '/range-report', tab: 'daily' } })}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <div className="absolute top-3 right-3 text-danger/20"><MinusCircle size={36} /></div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí ngày <span className="normal-case font-medium text-[11px]">/ngày</span></h3>
                                <div className="text-[18px] font-bold text-danger tabular-nums">- {formatVND(avg(stats.dailyExpense))}</div>
                            </div>
                            <div
                                onClick={() => navigate('/expenses', { state: { from: '/range-report', tab: 'fixed' } })}
                                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
                            >
                                <div className="absolute top-3 right-3 text-danger/20"><MinusCircle size={36} /></div>
                                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">CP cố định <span className="normal-case font-medium text-[11px]">/ngày</span></h3>
                                <div className="text-[18px] font-bold text-danger tabular-nums">- {formatVND(avg(stats.fixedExpense))}</div>
                            </div>

                            {/* Net profit */}
                            {(() => {
                                const isUp = stats.netProfit >= 0
                                return (
                                    <div className="col-span-2 bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex items-center justify-between relative overflow-hidden group">
                                        <div className={`absolute top-4 right-4 ${isUp ? 'text-success/20 group-hover:text-success/30' : 'text-danger/20 group-hover:text-danger/30'} transition-colors`}>
                                            {isUp ? <ArrowUp size={42} /> : <ArrowDown size={42} />}
                                        </div>
                                        <div className="flex flex-col">
                                            <h3 className="text-[11px] font-black text-text-secondary uppercase mb-1">Lợi nhuận ròng <span className="normal-case font-medium">({config.label.toLowerCase()})</span></h3>
                                            <div className={`text-[18px] font-bold tabular-nums ${stats.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {formatVND(stats.netProfit)}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <span className="text-[10px] font-black text-text-secondary uppercase mb-1 opacity-70">Trung bình/ngày</span>
                                            <div className={`px-3 py-1 rounded-xl border ${isUp ? 'bg-success/10 border-success/20 text-success' : 'bg-danger/10 border-danger/20 text-danger'}`}>
                                                <span className="text-[12px] font-black tabular-nums leading-none block">
                                                    {formatVND(avg(stats.netProfit))}
                                                </span>
                                            </div>
                                        </div>
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
