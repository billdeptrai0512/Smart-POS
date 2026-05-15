import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ChevronDown, Plus, X } from 'lucide-react'
import { formatVND, formatVNDInput, parseVNDInput, calculateProductCost } from '../../utils'
import { getPendingOrders, removePendingOrder } from '../../hooks/useOfflineSync'
import { fetchTodayShiftClosing, fetchExpensesByRange, fetchOrdersByRange } from '../../services/orderService'
import { getDateRange } from '../DailyReportPage/ReportHeader'
import { useAddress } from '../../contexts/AddressContext'
import { useProducts } from '../../contexts/ProductContext'
import { ingredientLabel, getIngredientUnit } from '../common/recipeUtils'

export default function HistoryView({
    todayOrders, todayExpenses, recipes, products, ingredientCosts, extraIngredients,
    isLoadingHistory, onBack, onDeleteOrder, onDeleteExpense, onRetrySync,
    onAddExpense,
    fixedCosts, handleAddFixedCost, handleUpdateFixedCost, handleDeleteFixedCost,
    isManager
}) {
    const navigate = useNavigate()
    const location = useLocation()
    const [deletingId, setDeletingId] = useState(null)
    const { selectedAddress } = useAddress()
    const { ingredientUnits } = useProducts()
    const [shiftClosed, setShiftClosed] = useState(null)
    const [pendingOrders, setPendingOrders] = useState(() => getPendingOrders())
    const [isSyncing, setIsSyncing] = useState(false)

    // State from drill-down navigation (DailyReport / RangeReport)
    const initialTab = location.state?.tab === 'expense' ? 'expense' : 'orders'
    const initialFilter = location.state?.filter || 'all'
    const expensesToView = location.state?.expensesToView  // read-only past date list
    const isReadOnly = location.state?.isReadOnly || false
    const backTo = location.state?.from

    // Tabs
    const [activeTab, setActiveTab] = useState(initialTab)
    const [expenseFilter, setExpenseFilter] = useState(initialFilter)

    // Expense add form — 3 types: 'expense' (auto-detect Trong/Sau ca), 'nvl', 'fixed'
    const [expenseCategory, setExpenseCategory] = useState('expense')
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deletingExpId, setDeletingExpId] = useState(null)
    const [showAddModal, setShowAddModal] = useState(false)
    const [showFilterMenu, setShowFilterMenu] = useState(false)

    // Date range — shared across orders/expense tabs
    const [scope, setScope] = useState('day')
    const [offset, setOffset] = useState(0)
    const [rangeExpenses, setRangeExpenses] = useState([])
    const [rangeOrders, setRangeOrders] = useState([])
    const [isLoadingRange, setIsLoadingRange] = useState(false)
    const [isLoadingRangeOrders, setIsLoadingRangeOrders] = useState(false)
    const rangeCache = useRef(new Map())
    const rangeOrdersCache = useRef(new Map())

    // Fixed cost management — inline edit/delete only; add is handled by main form
    const [editingFixedId, setEditingFixedId] = useState(null)
    const [editFixedName, setEditFixedName] = useState('')
    const [editFixedAmount, setEditFixedAmount] = useState('')
    const [deletingFixedId, setDeletingFixedId] = useState(null)

    const refreshPending = useCallback(() => setPendingOrders(getPendingOrders()), [])

    const handleDeleteOffline = useCallback((createdAt) => {
        if (!window.confirm('Xóa đơn offline này khỏi máy?')) return
        removePendingOrder(createdAt)
        refreshPending()
    }, [refreshPending])

    const handleRetrySync = useCallback(async () => {
        if (!onRetrySync) return
        setIsSyncing(true)
        try { await onRetrySync() }
        finally { setIsSyncing(false); refreshPending() }
    }, [onRetrySync, refreshPending])

    useEffect(() => {
        if (selectedAddress?.id) {
            setShiftClosed(null)
            fetchTodayShiftClosing(selectedAddress.id).then(data => setShiftClosed(!!data))
        } else {
            setShiftClosed(null)
        }
    }, [selectedAddress?.id])

    // ─── Expense date range ───────────────────────────────────────────

    const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
        const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        if (scope === 'day') {
            const target = new Date()
            target.setDate(target.getDate() + offset)
            const start = new Date(target); start.setHours(0, 0, 0, 0)
            const end = new Date(target); end.setHours(23, 59, 59, 999)
            return { rangeStart: start, rangeEnd: end, rangeLabel: `${fmt(start)}/${start.getFullYear()}` }
        }
        const { start, end } = getDateRange(scope, offset)
        return { rangeStart: start, rangeEnd: end, rangeLabel: `${fmt(start)} – ${fmt(end)}` }
    }, [scope, offset])

    const canGoForward = offset < 0

    useEffect(() => {
        if (!selectedAddress?.id || isReadOnly) return
        if (scope === 'day' && offset === 0) { setRangeExpenses([]); return }
        const cacheKey = `${selectedAddress.id}|${rangeStart.toISOString()}|${rangeEnd.toISOString()}`
        const cached = rangeCache.current.get(cacheKey)
        if (cached) { setRangeExpenses(cached); return }
        setIsLoadingRange(true)
        fetchExpensesByRange(selectedAddress.id, rangeStart, rangeEnd)
            .then(data => { rangeCache.current.set(cacheKey, data); setRangeExpenses(data) })
            .finally(() => setIsLoadingRange(false))
    }, [scope, offset, selectedAddress?.id, rangeStart.toISOString(), rangeEnd.toISOString(), isReadOnly])

    // Fetch orders by range — same cache pattern as expenses
    useEffect(() => {
        if (!selectedAddress?.id || isReadOnly) return
        if (scope === 'day' && offset === 0) { setRangeOrders([]); return }
        const cacheKey = `${selectedAddress.id}|${rangeStart.toISOString()}|${rangeEnd.toISOString()}`
        const cached = rangeOrdersCache.current.get(cacheKey)
        if (cached) { setRangeOrders(cached); return }
        setIsLoadingRangeOrders(true)
        fetchOrdersByRange(selectedAddress.id, rangeStart, rangeEnd)
            .then(data => { rangeOrdersCache.current.set(cacheKey, data); setRangeOrders(data) })
            .finally(() => setIsLoadingRangeOrders(false))
    }, [scope, offset, selectedAddress?.id, rangeStart.toISOString(), rangeEnd.toISOString(), isReadOnly])

    // ─── Orders tab data ───────────────────────────────────────────────

    const getItemCost = (productId, extras, snapshotUnitCost) => {
        if (snapshotUnitCost > 0) return snapshotUnitCost
        return calculateProductCost(productId, extras || [], recipes, extraIngredients, ingredientCosts)
    }

    const isTodayScope = scope === 'day' && offset === 0
    const baseOrders = isTodayScope ? (todayOrders || []) : rangeOrders
    const formattedOnline = baseOrders.map(o => {
        const cost = (o.total_cost > 0)
            ? o.total_cost
            : (o.order_items ? o.order_items.reduce((sum, i) => sum + (getItemCost(i.product_id, i.extras || [], i.unit_cost || 0) * i.quantity), 0) : 0)
        return {
            id: o.id,
            total: o.total,
            cost,
            createdAt: o.created_at,
            staffName: o.staff_name,
            deletedAt: o.deleted_at,
            deletedBy: o.deleted_by,
            isOffline: false,
            paymentMethod: o.payment_method || null,
            items: o.order_items ? o.order_items.map(i => {
                const options = i.options
                    ? i.options.split(', ').filter(opt => opt !== 'Tiền mặt' && opt !== 'MoMo').join(' - ')
                    : ''
                const pName = products?.find(p => p.id === i.product_id)?.name || i.products?.name || '☕'
                return {
                    text: `${i.quantity} ${pName}${options ? ` (${options})` : ''}`,
                    cost: getItemCost(i.product_id, i.extras || [], i.unit_cost || 0) * i.quantity,
                    quantity: i.quantity,
                    productId: i.product_id
                }
            }) : []
        }
    })

    const todayStr = new Date().toDateString()
    const formattedOffline = pendingOrders
        .filter(o => new Date(o.createdAt).toDateString() === todayStr)
        .map((o) => ({
            id: `offline-${o.createdAt}`,
            createdAt_key: o.createdAt,
            total: o.total,
            cost: o.totalCost > 0
                ? o.totalCost
                : (o.cart || o.orderItems || []).reduce((sum, i) => sum + (calculateProductCost(i.productId, i.extras || [], recipes, extraIngredients, ingredientCosts) * i.quantity), 0),
            createdAt: o.createdAt,
            staffName: o.staffName,
            isOffline: true,
            paymentMethod: o.paymentMethod || null,
            items: o.cart
                ? o.cart.map(i => {
                    const extras = i.extras.filter(e => e.name !== 'Tiền mặt' && e.name !== 'MoMo')
                    const itemCost = i.unitCost > 0 ? i.unitCost : calculateProductCost(i.productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                    return {
                        text: `${i.quantity} ${i.name}${extras.length ? ` (${extras.map(e => e.name).join(' - ')})` : ''}`,
                        cost: itemCost * i.quantity,
                        quantity: i.quantity,
                        productId: i.productId
                    }
                })
                : o.orderItems ? o.orderItems.map(i => {
                    const itemCost = i.unitCost > 0 ? i.unitCost : calculateProductCost(i.productId, i.extras || [], recipes, extraIngredients, ingredientCosts)
                    return { text: `${i.quantity} ${i.name}`, cost: itemCost * i.quantity, quantity: i.quantity, productId: i.productId }
                }) : []
        }))

    // Hide offline pending orders when viewing a non-today range (they only exist for today)
    const allOrders = [...formattedOnline, ...(isTodayScope ? formattedOffline : [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

    const productCountMap = useMemo(() => new Map((products || []).map(p => [p.id, p.count_as_cup !== false])), [products])
    const totalCups = allOrders.reduce((sum, o) => {
        if (o.isExpense || !o.items || o.deletedAt) return sum
        return sum + o.items.reduce((itemSum, item) => {
            if (item.productId && productCountMap.get(item.productId) === false) return itemSum
            return itemSum + (item.quantity || 0)
        }, 0)
    }, 0)

    const runningTotals = useMemo(() => {
        const map = new Map()
        let cumulative = 0
        for (const order of [...allOrders].reverse()) {
            if (!order.deletedAt) cumulative += order.total
            map.set(order.id, cumulative)
        }
        return map
    }, [allOrders])

    // ─── Expense tab data ─────────────────────────────────────────────

    const baseExpenses = useMemo(() => {
        if (expensesToView) return expensesToView
        if (scope === 'day' && offset === 0) return todayExpenses || []
        return rangeExpenses
    }, [expensesToView, scope, offset, todayExpenses, rangeExpenses])

    const nonFixedExpenses = useMemo(() => baseExpenses.filter(e => !e.is_fixed), [baseExpenses])

    // Header pill always shows today total regardless of selected range
    const totalNonFixedToday = useMemo(
        () => (todayExpenses || []).filter(e => !e.is_fixed).reduce((s, e) => s + (e.amount || 0), 0),
        [todayExpenses]
    )

    const isLoadingExpenses = isReadOnly ? false : (scope === 'day' && offset === 0 ? isLoadingHistory : isLoadingRange)

    const filteredExpenses = useMemo(() => {
        let list = nonFixedExpenses
        if (expenseFilter === 'daily') list = list.filter(e => !e.is_refill)
        else if (expenseFilter === 'after') list = list.filter(e => e.is_refill && e.metadata?.free_form)
        else if (expenseFilter === 'operation') list = list.filter(e => !e.is_refill || (e.is_refill && e.metadata?.free_form))
        else if (expenseFilter === 'nvl') list = list.filter(e => e.is_refill && !e.metadata?.free_form)
        else if (expenseFilter === 'fixed') list = []
        return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [nonFixedExpenses, expenseFilter])

    // Cumulative inflow per ingredient — computed from all NVL refills in baseExpenses, walking
    // oldest→newest. Per refill: stock_before = running total just before, stock_after = + qty.
    const nvlStockSnapshot = useMemo(() => {
        const snapshot = new Map()  // expense.id → { before, after }
        const running = {}  // ingredient → cumulative qty
        const asc = [...baseExpenses].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        for (const e of asc) {
            if (!e.is_refill || e.metadata?.free_form) continue
            const ing = e.metadata?.ingredient
            if (!ing) continue
            const qty = Number(e.metadata?.qty) || 0
            const before = running[ing] || 0
            const after = before + qty
            running[ing] = after
            snapshot.set(e.id, { before, after })
        }
        return snapshot
    }, [baseExpenses])

    const totalNonFixedRange = nonFixedExpenses.reduce((s, e) => s + (e.amount || 0), 0)

    const getExpenseBadge = (e) => {
        if (e.is_refill && !e.metadata?.free_form) return { main: 'Tồn kho', sub: null, cls: 'bg-primary/10 text-primary' }
        if (e.is_refill && e.metadata?.free_form) return { main: 'Vận hành', sub: 'Sau ca', cls: 'bg-danger/10 text-danger' }
        return { main: 'Vận hành', sub: 'Trong ca', cls: 'bg-danger/10 text-danger' }
    }

    // ─── Expense form handlers ────────────────────────────────────────

    const submitExpense = async () => {
        if (!costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            const amount = Number(costAmount) * 1000
            if (expenseCategory === 'fixed') {
                await handleAddFixedCost(costName.trim(), amount)
            } else if (expenseCategory === 'nvl') {
                await onAddExpense(costName.trim(), amount, true, 'cash', {})
            } else {
                // 'expense' — auto-detect Trong ca vs Sau ca from shift_finalized flag
                const today = new Date().toISOString().split('T')[0]
                const isFinalized = selectedAddress?.id && !!localStorage.getItem(`shift_finalized_${selectedAddress.id}_${today}`)
                if (isFinalized) {
                    await onAddExpense(costName.trim(), amount, true, 'cash', { free_form: true })
                } else {
                    await onAddExpense(costName.trim(), amount, false, 'cash', {})
                }
            }
            setCostName('')
            setCostAmount('')
            setShowAddModal(false)
        } catch { }
        finally { setIsSubmitting(false) }
    }

    const startEditFixed = (fc) => {
        setEditingFixedId(fc.id)
        setEditFixedName(fc.name)
        setEditFixedAmount(formatVNDInput(fc.amount))
    }

    const submitEditFixed = async () => {
        if (!editFixedName.trim() || !editFixedAmount || parseVNDInput(editFixedAmount) <= 0) return
        try {
            await handleUpdateFixedCost(editingFixedId, { name: editFixedName.trim(), amount: parseVNDInput(editFixedAmount) })
            setEditingFixedId(null)
        } catch { }
    }

    // ─── Render ───────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={backTo ? () => navigate(backTo) : onBack}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                        <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nhật ký</span>
                        {!isReadOnly ? (
                            <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
                                <button
                                    onClick={() => setOffset(p => p - 1)}
                                    className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
                                >
                                    <ChevronLeft size={14} strokeWidth={2.5} />
                                </button>
                                <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums">{rangeLabel}</span>
                                <button
                                    onClick={() => canGoForward && setOffset(p => p + 1)}
                                    className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canGoForward ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
                                >
                                    <ChevronRight size={14} strokeWidth={2.5} />
                                </button>
                            </div>
                        ) : (
                            <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{totalCups} ly</span>
                        )}
                    </div>

                    <button
                        onClick={() => navigate('/recipes')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowRight size={20} strokeWidth={2.5} />
                    </button>
                </div>

                {!isReadOnly && (
                    <div className="grid grid-cols-3 gap-2">
                        {[{ key: 'week', label: 'Tuần này' }, { key: 'day', label: 'Hôm nay' }, { key: 'month', label: 'Tháng này' }].map(s => (
                            <button
                                key={s.key}
                                onClick={() => { setScope(s.key); setOffset(0) }}
                                className={`py-2 rounded-[12px] text-[12px] font-black border transition-colors ${scope === s.key
                                    ? 'bg-primary/10 border-primary/40 text-primary'
                                    : 'bg-surface-light border-border/60 text-text-secondary hover:bg-border/30'
                                    }`}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                )}
            </header>

            {/* ═════ ORDERS TAB ═════ */}
            {activeTab === 'orders' && (
                <main className="flex-1 overflow-y-auto px-4 py-5 pb-4 space-y-3 bg-bg">
                    {pendingOrders.length > 0 && (
                        <div className="bg-warning/10 border border-warning/40 rounded-[14px] px-4 py-3 flex items-center justify-between gap-3">
                            <div className="flex flex-col min-w-0">
                                <span className="text-[13px] font-black text-warning">{pendingOrders.length} đơn chờ đồng bộ</span>
                                <span className="text-[11px] text-text-dim mt-0.5">Đơn offline chưa lên hệ thống</span>
                            </div>
                            <button
                                onClick={handleRetrySync}
                                disabled={isSyncing}
                                className="shrink-0 bg-warning text-bg text-[12px] font-black px-3 py-1.5 rounded-lg disabled:opacity-60"
                            >
                                {isSyncing ? 'Đang sync...' : 'Thử lại'}
                            </button>
                        </div>
                    )}
                    {(isTodayScope ? isLoadingHistory : isLoadingRangeOrders) ? (
                        <div className="flex justify-center py-10">
                            <span className="text-text-secondary font-medium">Đang tải...</span>
                        </div>
                    ) : allOrders.length === 0 ? (
                        <div className="flex justify-center py-10">
                            <span className="text-text-secondary font-medium">{isTodayScope ? 'Chưa có đơn hàng nào hôm nay.' : 'Không có đơn hàng trong khoảng này.'}</span>
                        </div>
                    ) : (
                        allOrders.map(order => {
                            const date = new Date(order.createdAt)
                            const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
                            return (
                                <div key={order.id} className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden ${order.deletedAt ? 'opacity-50 grayscale select-none' : ''}`}>
                                    {order.deletedAt && (
                                        <div className="absolute top-0 left-0 bg-danger/20 text-danger text-[10px] font-black px-3 py-1 rounded-br-[14px] uppercase tracking-wider z-10">
                                            ĐÃ XÓA {order.deletedBy ? `BỞI ${order.deletedBy.toUpperCase()}` : ''}
                                        </div>
                                    )}
                                    {order.isOffline && !order.deletedAt && (
                                        <div className="absolute top-0 right-0 bg-warning/20 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                            Offline
                                        </div>
                                    )}
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-black text-[14px] text-primary mt-1">+ {formatVND(order.total)}</span>
                                        {!order.deletedAt && (
                                            <span className="text-success leading-none text-[14px] mt-1 font-bold tabular-nums">
                                                {formatVND(runningTotals.get(order.id) || 0)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                        <div className="flex flex-col justify-between flex-1 gap-1.5 mt-0.5 mr-2">
                                            <div className="flex flex-col gap-1.5 flex-1">
                                                {order.items?.length > 0 ? order.items.map((item, idx) => (
                                                    <div key={idx} className="flex flex-row gap-2 items-start w-full">
                                                        <span className={`text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text ${order.deletedAt ? 'line-through' : ''}`}>{item.text}</span>
                                                    </div>
                                                )) : (
                                                    <span className="text-text text-[14px] leading-snug font-medium whitespace-pre-wrap">Không có chi tiết</span>
                                                )}
                                            </div>
                                            {order.staffName && (
                                                <div className="flex items-end pb-[1px] mt-1">
                                                    <span className="text-text-secondary/70 text-[12px] font-bold truncate max-w-[150px] leading-none">{order.staffName}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                            {order.deletedAt ? (
                                                <span className="text-text-secondary/50 text-[14px] font-bold leading-none">{time}</span>
                                            ) : !order.isOffline ? (
                                                <span
                                                    className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none leading-none"
                                                    onClick={() => {
                                                        if (deletingId === order.id) return
                                                        const text = order.items?.map(i => i.text).join(', ') || ''
                                                        if (window.confirm(`Xóa đơn ${text} (${formatVND(order.total)})?\n\nHành động này không thể hoàn tác!`)) {
                                                            setDeletingId(order.id)
                                                            onDeleteOrder(order.id).finally(() => setDeletingId(null))
                                                        }
                                                    }}
                                                >
                                                    {deletingId === order.id ? '⏳' : time}
                                                </span>
                                            ) : (
                                                <div className="flex items-end gap-2 leading-none">
                                                    <span
                                                        className="text-warning/70 hover:text-danger text-[11px] font-bold cursor-pointer underline underline-offset-2 transition-colors leading-none"
                                                        onClick={() => handleDeleteOffline(order.createdAt_key)}
                                                    >
                                                        Xóa
                                                    </span>
                                                    <span className="text-text-secondary text-[14px] font-bold leading-none">{time}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </main>
            )}

            {/* ═════ EXPENSE TAB ═════ */}
            {activeTab === 'expense' && (
                <main className="flex-1 overflow-y-auto px-4 py-4 pb-4 space-y-3 bg-bg">
                    {/* Filter dropdown + Add button */}
                    <div className="flex items-center justify-between gap-2">
                        <div className='relative'>
                            {!isReadOnly && (
                                <button
                                    onClick={() => setShowAddModal(true)}
                                    className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] uppercase font-bold bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-all"
                                >
                                    <Plus size={12} strokeWidth={3} /> Thêm
                                </button>
                            )}
                        </div>

                        <div className="relative">
                            <button
                                onClick={() => setShowFilterMenu(v => !v)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] uppercase font-bold border bg-surface-light border-border/60 text-text-secondary hover:text-text transition-all"
                            >
                                {({ all: 'Tất cả', operation: 'Vận hành', daily: 'Trong ca', after: 'Sau ca', nvl: 'Tồn kho', fixed: 'Cố định' })[expenseFilter]}
                                <ChevronDown size={12} className={`transition-transform ${showFilterMenu ? 'rotate-180' : ''}`} />
                            </button>
                            {showFilterMenu && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowFilterMenu(false)} />
                                    <div className="absolute right-0 top-full mt-1 z-20 bg-surface border border-border/60 rounded-[12px] shadow-xl overflow-hidden min-w-[120px]">
                                        {[
                                            { key: 'all', label: 'Tất cả' },
                                            { key: 'operation', label: 'Vận hành' },
                                            { key: 'nvl', label: 'Tồn kho' },
                                            { key: 'fixed', label: 'Cố định' },
                                        ].map(f => (
                                            <button
                                                key={f.key}
                                                onClick={() => { setExpenseFilter(f.key); setShowFilterMenu(false) }}
                                                className={`w-full text-left px-3 py-2 text-[12px] uppercase font-bold transition-colors ${expenseFilter === f.key ? 'text-text bg-primary/10' : 'text-text-secondary hover:text-text hover:bg-surface-light'}`}
                                            >
                                                {f.label}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                    </div>

                    {/* Fixed costs sub-section (manager only) */}
                    {isManager && expenseFilter === 'fixed' && (
                        <div className="bg-surface border border-warning/20 rounded-[20px] p-4 shadow-sm flex flex-col gap-3">
                            <span className="text-[11px] font-black text-warning uppercase tracking-wider">Chi phí cố định</span>
                            {(!fixedCosts || fixedCosts.length === 0) ? (
                                <span className="text-[13px] text-text-secondary text-center py-2">Chưa có chi phí cố định.</span>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {fixedCosts.map(fc => (
                                        <div key={fc.id} className="flex flex-col gap-2 border-b border-border/30 pb-2 last:border-0 last:pb-0">
                                            {editingFixedId === fc.id ? (
                                                <div className="flex flex-col gap-2">
                                                    <input
                                                        type="text"
                                                        value={editFixedName}
                                                        onChange={e => setEditFixedName(e.target.value)}
                                                        className="bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[14px] font-medium text-text focus:outline-none focus:border-warning/40"
                                                        autoFocus
                                                    />
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={editFixedAmount}
                                                            onChange={e => setEditFixedAmount(formatVNDInput(e.target.value))}
                                                            className="flex-1 bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[14px] font-medium text-text focus:outline-none focus:border-warning/40"
                                                        />
                                                        <button onClick={submitEditFixed} className="px-4 py-2 rounded-[10px] bg-warning text-white text-[13px] font-black">Lưu</button>
                                                        <button onClick={() => setEditingFixedId(null)} className="px-3 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-[13px] font-bold">Hủy</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-between">
                                                    <div className="flex flex-col">
                                                        <span className="text-[14px] font-medium text-text">{fc.name}</span>
                                                        <span className="text-[13px] font-black text-warning tabular-nums">-{formatVND(fc.amount)}</span>
                                                    </div>
                                                    {!isReadOnly && (
                                                        <div className="flex items-center gap-3">
                                                            <span onClick={() => startEditFixed(fc)} className="text-primary text-[13px] font-bold cursor-pointer hover:text-primary/80 select-none">Sửa</span>
                                                            <span
                                                                onClick={() => {
                                                                    if (deletingFixedId === fc.id) return
                                                                    if (window.confirm(`Xóa chi phí cố định "${fc.name}"?\n\nChi phí này sẽ không còn được tính vào các ca sau.`)) {
                                                                        setDeletingFixedId(fc.id)
                                                                        handleDeleteFixedCost(fc.id).finally(() => setDeletingFixedId(null))
                                                                    }
                                                                }}
                                                                className="text-danger text-[13px] font-bold cursor-pointer hover:text-danger/80 select-none"
                                                            >
                                                                {deletingFixedId === fc.id ? '⏳' : 'Xóa'}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Expense cards */}
                    {isLoadingExpenses ? (
                        <div className="flex flex-col gap-3 animate-pulse">
                            <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                            <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                        </div>
                    ) : filteredExpenses.length === 0 ? (
                        expenseFilter !== 'fixed' && (
                            <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                                Chưa có chi phí nào.
                            </div>
                        )
                    ) : (
                        filteredExpenses.map(expense => {
                            const badge = getExpenseBadge(expense)
                            const d = new Date(expense.created_at)
                            const time = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
                            const isNvlWithMeta = expense.is_refill && !expense.metadata?.free_form && expense.metadata?.ingredient
                            const ingKey = isNvlWithMeta ? expense.metadata.ingredient : null
                            const qty = isNvlWithMeta ? Number(expense.metadata?.qty) || 0 : 0
                            const unit = ingKey ? getIngredientUnit(ingKey, undefined, ingredientUnits) : ''
                            const snap = isNvlWithMeta ? nvlStockSnapshot.get(expense.id) : null
                            return (
                                <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                                    <div className={`absolute top-0 right-0 px-2 py-1 rounded-bl-[14px] flex flex-col items-end leading-tight ${badge.cls}`}>
                                        <span className="text-[10px] font-black uppercase tracking-wider">{badge.main}</span>
                                        {badge.sub && <span className="text-[9px] font-medium opacity-70 normal-case">{badge.sub}</span>}
                                    </div>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className={`font-black text-[14px] mt-1 ${expense.is_refill ? 'text-warning' : 'text-danger'}`}>
                                            -{formatVND(expense.amount)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                        <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                            {isNvlWithMeta ? (
                                                <div className="flex flex-col gap-2">
                                                    <span className="text-[14px] leading-snug font-medium whitespace-pre-wrap text-text">
                                                        {ingredientLabel(ingKey)}
                                                    </span>
                                                    <span className="text-text-secondary/70 text-[11px] font-bold leading-none tabular-nums">
                                                        Nhập thêm: {qty > 0 ? '+' : ''}{qty} {unit}
                                                    </span>
                                                    {snap && (
                                                        <span className="text-text-secondary/70 text-[11px] font-bold leading-none tabular-nums">
                                                            Tồn kho: {Math.round(snap.before * 10) / 10} → {Math.round(snap.after * 10) / 10} {unit}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                                            )}
                                            {expense.staff_name && (
                                                <span className="text-text-secondary/70 text-[12px] font-bold leading-none">{expense.staff_name}</span>
                                            )}
                                        </div>
                                        <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                            {isReadOnly ? (
                                                <span className="text-text-dim text-[14px] font-bold">{time}</span>
                                            ) : (
                                                <span
                                                    className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none leading-none"
                                                    onClick={() => {
                                                        if (deletingExpId === expense.id) return
                                                        if (window.confirm(`Xóa chi phí "${expense.name}"?\n\nHành động này không thể hoàn tác!`)) {
                                                            setDeletingExpId(expense.id)
                                                            onDeleteExpense(expense.id, expense.amount).finally(() => setDeletingExpId(null))
                                                        }
                                                    }}
                                                >
                                                    {deletingExpId === expense.id ? '⏳' : time}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </main>
            )}

            {/* Add expense modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={() => setShowAddModal(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[16px] font-black text-text">Thêm chi phí</span>
                            <button onClick={() => setShowAddModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex bg-surface-light border border-border/60 rounded-[12px] p-0.5">
                            <button onClick={() => setExpenseCategory('expense')} className={`flex-1 py-1.5 rounded-[10px] text-[12px] font-black uppercase transition-all ${expenseCategory === 'expense' ? 'bg-danger/80 text-white shadow-sm' : 'text-text-secondary hover:text-text'}`}>Vận hành</button>
                            <button onClick={() => setExpenseCategory('nvl')} className={`flex-1 py-1.5 rounded-[10px] text-[12px] font-black uppercase transition-all ${expenseCategory === 'nvl' ? 'bg-primary/80 text-white shadow-sm' : 'text-text-secondary hover:text-text'}`}>Tồn kho</button>
                            <button onClick={() => setExpenseCategory('fixed')} className={`flex-1 py-1.5 rounded-[10px] text-[12px] font-black uppercase transition-all ${expenseCategory === 'fixed' ? 'bg-warning/80 text-white shadow-sm' : 'text-text-secondary hover:text-text'}`}>Cố định</button>
                        </div>
                        <input
                            type="text"
                            autoFocus
                            placeholder="Tên chi phí..."
                            value={costName}
                            onChange={e => setCostName(e.target.value)}
                            className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[15px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                        />
                        <div className="relative flex items-center bg-surface-light border border-border/60 rounded-[12px] overflow-hidden focus-within:border-primary/50">
                            <input
                                type="number"
                                placeholder="0"
                                value={costAmount}
                                onChange={e => setCostAmount(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitExpense() }}
                                className="w-full bg-transparent px-4 py-3 text-[15px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            {costAmount && <span className="absolute right-4 text-[15px] font-medium text-text-secondary pointer-events-none">.000đ</span>}
                        </div>
                        <button
                            onClick={submitExpense}
                            disabled={!costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || isSubmitting || !costName.trim()}
                            className={`w-full py-3.5 rounded-[14px] text-white text-[15px] font-black uppercase tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed ${expenseCategory === 'nvl' ? 'bg-primary' : expenseCategory === 'fixed' ? 'bg-warning' : 'bg-danger'}`}
                        >
                            {isSubmitting ? 'Đang lưu...' : 'Xác nhận'}
                        </button>
                    </div>
                </div>
            )}

            {/* Shared footer tab bar */}
            <div className="shrink-0 bg-surface border-t border-border/60 flex gap-1.5 px-3 py-2">


                <button
                    onClick={() => setActiveTab('orders')}
                    className={`flex-1 flex flex-col items-center py-1.5 rounded-[10px] transition-all ${activeTab === 'orders' ? 'bg-primary/10' : 'hover:bg-border/20'}`}
                >
                    <span className={`text-[12px] font-black uppercase ${activeTab === 'orders' ? 'text-primary' : 'text-text-secondary'}`}>Thu nhập</span>
                    <span className={`text-[12px] font-bold tabular-nums mt-0.5 ${activeTab === 'orders' ? 'text-text/80' : 'text-text-dim'}`}>{totalCups} ly</span>
                </button>
                <button
                    onClick={() => setActiveTab('expense')}
                    className={`flex-1 flex flex-col items-center py-1.5 rounded-[10px] transition-all ${activeTab === 'expense' ? 'bg-danger/10' : 'hover:bg-border/20'}`}
                >
                    <span className={`text-[12px] font-black uppercase ${activeTab === 'expense' ? 'text-danger' : 'text-text-secondary'}`}>Chi phí</span>
                    <span className={`text-[12px] font-bold tabular-nums mt-0.5 ${activeTab === 'expense' ? 'text-text/80' : 'text-text-dim'}`}>-{formatVND(totalNonFixedRange)}</span>
                </button>

                <button
                    onClick={() => {
                        if (scope === 'week' || scope === 'month') {
                            navigate(`/range-report?range=${scope}`, { state: { offset, from: '/history' } })
                        } else if (offset !== 0) {
                            const d = new Date()
                            d.setDate(d.getDate() + offset)
                            navigate('/daily-report', { state: { initialDate: d.toISOString().split('T')[0] } })
                        } else {
                            navigate('/daily-report')
                        }
                    }}
                    className="flex flex-col items-center justify-center px-4 py-1.5 rounded-[10px] bg-success/10 hover:bg-success/20 transition-all"
                >
                    <span className="text-[12px] font-black text-success uppercase">Báo cáo</span>
                </button>

            </div>
        </div>
    )
}
