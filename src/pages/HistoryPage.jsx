import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatVNDInput, parseVNDInput, calculateProductCost } from '../utils'
import { getPendingOrders, removePendingOrder } from '../hooks/useOfflineSync'
import { fetchTodayShiftClosing, fetchExpensesByRange, fetchOrdersByRange } from '../services/orderService'
import { getDateRange } from '../components/DailyReportPage/ReportHeader'
import { useAddress } from '../contexts/AddressContext'
import { useProducts } from '../contexts/ProductContext'
import { usePOS } from '../contexts/POSContext'
import { useAuth } from '../contexts/AuthContext'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import OrdersList from '../components/HistoryPage/OrdersList'
import ExpensePanel from '../components/HistoryPage/ExpensePanel'
import AddExpenseModal from '../components/HistoryPage/AddExpenseModal'
import HistoryFooter from '../components/HistoryPage/HistoryFooter'

const getLocalISO = (date = new Date()) => {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const dd = String(date.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
}

export default function HistoryPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { selectedAddress } = useAddress()
    const { products, recipes, ingredientCosts, extraIngredients, ingredientUnits, refreshProducts } = useProducts()
    const {
        todayOrders, todayExpenses, isLoadingHistory,
        handleDeleteOrder, handleAddExpense, handleDeleteExpense, handleLoadHistory, retrySync,
        fixedCosts, handleAddFixedCost, handleUpdateFixedCost, handleDeleteFixedCost, refreshTodayExpenses,
    } = usePOS()
    const { isManager: isManagerRole, isAdmin, profile } = useAuth()
    const isManager = isManagerRole || isAdmin

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ─── Navigation state ─────────────────────────────────────────────
    const initialTab = location.state?.tab === 'expense' ? 'expense' : 'orders'
    const initialFilter = location.state?.filter || 'operation'
    const expensesToView = location.state?.expensesToView  // read-only past date list
    const isReadOnly = location.state?.isReadOnly || false
    const backTo = location.state?.from || '/pos'
    // Scope/offset hand-off from RangeReport footer (Tuần/Tháng) so the manager keeps
    // their date window when toggling tabs.
    const initialScope = ['day', 'week', 'month'].includes(location.state?.scope) ? location.state.scope : 'day'
    const initialOffset = typeof location.state?.offset === 'number' ? location.state.offset : 0

    // ─── UI state ─────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState(initialTab)
    const [expenseFilter, setExpenseFilter] = useState(initialFilter)
    const [showAddModal, setShowAddModal] = useState(false)

    const [scope, setScope] = useState(initialScope)
    const [offset, setOffset] = useState(initialOffset)
    const [customRange, setCustomRange] = useState(null) // { startISO, endISO } when scope === 'custom'
    // True only when user picked a past day via the calendar input (not via chevrons).
    // Gates the "→ ngày" end-pick chip so chevron-stepping doesn't surface the range UI.
    const [hasManualPick, setHasManualPick] = useState(false)

    // ─── Orders state ─────────────────────────────────────────────────
    const [deletingId, setDeletingId] = useState(null)
    const [pendingOrders, setPendingOrders] = useState(() => getPendingOrders())
    const [isSyncing, setIsSyncing] = useState(false)

    // ─── Expense state ────────────────────────────────────────────────
    const [deletingExpId, setDeletingExpId] = useState(null)
    const [editingFixedId, setEditingFixedId] = useState(null)
    const [editFixedName, setEditFixedName] = useState('')
    const [editFixedAmount, setEditFixedAmount] = useState('')
    const [deletingFixedId, setDeletingFixedId] = useState(null)

    // ─── Add-expense form state ───────────────────────────────────────
    const [expenseCategory, setExpenseCategory] = useState('expense') // 'expense' | 'nvl' | 'fixed'
    const [fixedSubMode, setFixedSubMode] = useState('setup') // 'setup' | 'actual'
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Reset form when modal closes
    useEffect(() => {
        if (!showAddModal) {
            setCostName('')
            setCostAmount('')
            setFixedSubMode('setup')
            setExpenseCategory('expense')
        }
    }, [showAddModal])

    // ─── Range fetch ──────────────────────────────────────────────────
    const [rangeExpenses, setRangeExpenses] = useState([])
    const [rangeOrders, setRangeOrders] = useState([])
    const [isLoadingRange, setIsLoadingRange] = useState(false)
    const [isLoadingRangeOrders, setIsLoadingRangeOrders] = useState(false)
    const rangeCache = useRef(new Map())
    const rangeOrdersCache = useRef(new Map())

    const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
        const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        if (scope === 'day') {
            const target = new Date()
            target.setDate(target.getDate() + offset)
            const start = new Date(target); start.setHours(0, 0, 0, 0)
            const end = new Date(target); end.setHours(23, 59, 59, 999)
            return { rangeStart: start, rangeEnd: end, rangeLabel: `${fmt(start)}/${start.getFullYear()}` }
        }
        if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
            const [sy, sm, sd] = customRange.startISO.split('-')
            const [ey, em, ed] = customRange.endISO.split('-')
            const start = new Date(sy, sm - 1, sd); start.setHours(0, 0, 0, 0)
            const end = new Date(ey, em - 1, ed); end.setHours(23, 59, 59, 999)
            return { rangeStart: start, rangeEnd: end, rangeLabel: `${fmt(start)} – ${fmt(end)}` }
        }
        const { start, end } = getDateRange(scope, offset)
        return { rangeStart: start, rangeEnd: end, rangeLabel: `${fmt(start)} – ${fmt(end)}` }
    }, [scope, offset, customRange])

    const canGoForward = offset < 0
    const isTodayScope = scope === 'day' && offset === 0
    const isCustomScope = scope === 'custom'

    // ─── Custom range handlers ────────────────────────────────────────
    // Tab change: always exits custom mode and resets offset.
    const handleScopeChange = (next) => {
        setOffset(0)
        setScope(next)
        setHasManualPick(false)
    }

    const handleCustomStartChange = (iso) => {
        if (!iso) return
        const clampedEnd = customRange?.endISO || iso
        // start must be <= end and <= today
        const safeStart = iso > clampedEnd ? clampedEnd : (iso > todayISORef() ? todayISORef() : iso)
        setCustomRange({ startISO: safeStart, endISO: clampedEnd })
    }

    const handleCustomEndChange = (iso) => {
        if (!iso) return
        const start = customRange?.startISO || iso
        const today = todayISORef()
        const safeEnd = iso > today ? today : (iso < start ? start : iso)
        setCustomRange({ startISO: start, endISO: safeEnd })
    }

    // todayISO is declared below; stable getter via fresh call avoids forward-ref churn
    function todayISORef() { return getLocalISO(new Date()) }

    // ─── Day-mode date picker ─────────────────────────────────────────
    const todayISO = getLocalISO(new Date())
    const dayCustomDate = useMemo(() => {
        if (scope !== 'day' || offset === 0) return null
        const d = new Date()
        d.setDate(d.getDate() + offset)
        return getLocalISO(d)
    }, [scope, offset])
    const dayInputValue = dayCustomDate || todayISO
    const canGoForwardDay = dayInputValue < todayISO

    const setOffsetFromISO = (iso) => {
        if (!iso || iso >= todayISO) { setOffset(0); setHasManualPick(false); return }
        const [y, m, d] = iso.split('-')
        const target = new Date(y, m - 1, d); target.setHours(0, 0, 0, 0)
        const today = new Date(); today.setHours(0, 0, 0, 0)
        setOffset(Math.round((target - today) / 86400000))
    }
    // Calendar pick: flag manual so the "→ ngày" end chip can appear.
    const handleManualDatePick = (iso) => {
        setHasManualPick(true)
        setOffsetFromISO(iso)
    }
    const handlePrevDay = () => {
        setHasManualPick(false)
        const [y, m, d] = dayInputValue.split('-')
        const next = new Date(y, m - 1, d); next.setDate(next.getDate() - 1)
        setOffsetFromISO(getLocalISO(next))
    }
    const handleNextDay = () => {
        if (dayInputValue >= todayISO) return
        setHasManualPick(false)
        const [y, m, d] = dayInputValue.split('-')
        const next = new Date(y, m - 1, d); next.setDate(next.getDate() + 1)
        setOffsetFromISO(getLocalISO(next))
    }

    // Day mode: user extends single-day selection into a range by picking an end date.
    // If end > start, switch implicitly to 'custom' scope (no tab highlighted).
    const handleDayEndPick = (endISO) => {
        if (!dayCustomDate || !endISO) return
        if (endISO <= dayCustomDate) return // not a forward range — keep day mode
        const cappedEnd = endISO > todayISO ? todayISO : endISO
        setCustomRange({ startISO: dayCustomDate, endISO: cappedEnd })
        setScope('custom')
    }

    // ─── Range data fetchers ──────────────────────────────────────────
    useEffect(() => {
        if (!selectedAddress?.id || isReadOnly) return
        if (isTodayScope) { setRangeExpenses([]); return }
        const cacheKey = `${selectedAddress.id}|${rangeStart.toISOString()}|${rangeEnd.toISOString()}`
        const cached = rangeCache.current.get(cacheKey)
        if (cached) { setRangeExpenses(cached); return }
        setIsLoadingRange(true)
        fetchExpensesByRange(selectedAddress.id, rangeStart, rangeEnd)
            .then(data => { rangeCache.current.set(cacheKey, data); setRangeExpenses(data) })
            .finally(() => setIsLoadingRange(false))
    }, [scope, offset, selectedAddress?.id, rangeStart.toISOString(), rangeEnd.toISOString(), isReadOnly, isTodayScope])

    useEffect(() => {
        if (!selectedAddress?.id || isReadOnly) return
        if (isTodayScope) { setRangeOrders([]); return }
        const cacheKey = `${selectedAddress.id}|${rangeStart.toISOString()}|${rangeEnd.toISOString()}`
        const cached = rangeOrdersCache.current.get(cacheKey)
        if (cached) { setRangeOrders(cached); return }
        setIsLoadingRangeOrders(true)
        fetchOrdersByRange(selectedAddress.id, rangeStart, rangeEnd)
            .then(data => { rangeOrdersCache.current.set(cacheKey, data); setRangeOrders(data) })
            .finally(() => setIsLoadingRangeOrders(false))
    }, [scope, offset, selectedAddress?.id, rangeStart.toISOString(), rangeEnd.toISOString(), isReadOnly, isTodayScope])

    // ─── Offline order sync ───────────────────────────────────────────
    const refreshPending = useCallback(() => setPendingOrders(getPendingOrders()), [])

    const handleDeleteOffline = useCallback((createdAt) => {
        if (!window.confirm('Xóa đơn offline này khỏi máy?')) return
        removePendingOrder(createdAt)
        refreshPending()
    }, [refreshPending])

    const handleRetrySync = useCallback(async () => {
        if (!retrySync) return
        setIsSyncing(true)
        try { await retrySync() }
        finally { setIsSyncing(false); refreshPending() }
    }, [retrySync, refreshPending])

    // ─── Orders data ──────────────────────────────────────────────────
    const getItemCost = (productId, extras, snapshotUnitCost) => {
        if (snapshotUnitCost > 0) return snapshotUnitCost
        return calculateProductCost(productId, extras || [], recipes, extraIngredients, ingredientCosts)
    }

    const baseOrders = isTodayScope ? (todayOrders || []) : rangeOrders

    // PERF: index products by id once (was: products?.find() inside every order's item map).
    const productById = useMemo(() => {
        const m = new Map()
        for (const p of products || []) m.set(p.id, p)
        return m
    }, [products])

    // PERF: memoize formatted lists so downstream useMemo's (runningTotals, totalCups) actually
    // get stable inputs. Previously these recomputed every render → all derived memos were busted.
    const formattedOnline = useMemo(() => baseOrders.map(o => {
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
                const pName = productById.get(i.product_id)?.name || i.products?.name || '☕'
                return {
                    text: `${i.quantity} ${pName}${options ? ` (${options})` : ''}`,
                    cost: getItemCost(i.product_id, i.extras || [], i.unit_cost || 0) * i.quantity,
                    quantity: i.quantity,
                    productId: i.product_id
                }
            }) : []
        }
    }), [baseOrders, productById, recipes, extraIngredients, ingredientCosts])

    const formattedOffline = useMemo(() => {
        const todayStr = new Date().toDateString()
        return pendingOrders
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
    }, [pendingOrders, recipes, extraIngredients, ingredientCosts])

    // Hide offline pending orders when viewing a non-today range (they only exist for today)
    const allOrders = useMemo(
        () => [...formattedOnline, ...(isTodayScope ? formattedOffline : [])]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        [formattedOnline, formattedOffline, isTodayScope]
    )

    const productCountMap = useMemo(() => new Map((products || []).map(p => [p.id, p.count_as_cup !== false])), [products])

    const totalCups = useMemo(() => allOrders.reduce((sum, o) => {
        if (o.isExpense || !o.items || o.deletedAt) return sum
        return sum + o.items.reduce((itemSum, item) => {
            if (item.productId && productCountMap.get(item.productId) === false) return itemSum
            return itemSum + (item.quantity || 0)
        }, 0)
    }, 0), [allOrders, productCountMap])

    const runningTotals = useMemo(() => {
        const map = new Map()
        let cumulative = 0
        for (let i = allOrders.length - 1; i >= 0; i--) {
            const order = allOrders[i]
            if (!order.deletedAt) cumulative += order.total
            map.set(order.id, cumulative)
        }
        return map
    }, [allOrders])

    // ─── Expense data ─────────────────────────────────────────────────
    const baseExpenses = useMemo(() => {
        if (expensesToView) return expensesToView
        if (isTodayScope) return todayExpenses || []
        return rangeExpenses
    }, [expensesToView, isTodayScope, todayExpenses, rangeExpenses])

    const nonFixedExpenses = useMemo(() => baseExpenses.filter(e => !e.is_fixed), [baseExpenses])
    const fixedPayments = useMemo(() => baseExpenses.filter(e => e.is_fixed).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [baseExpenses])

    const isLoadingExpenses = isReadOnly ? false : (isTodayScope ? isLoadingHistory : isLoadingRange)

    const filteredExpenses = useMemo(() => {
        let list = nonFixedExpenses
        if (expenseFilter === 'daily') list = list.filter(e => !e.is_refill)
        else if (expenseFilter === 'after') list = list.filter(e => e.is_refill && e.metadata?.free_form)
        else if (expenseFilter === 'operation') list = list.filter(e => !e.is_refill || (e.is_refill && e.metadata?.free_form))
        else if (expenseFilter === 'nvl') list = list.filter(e => e.is_refill && !e.metadata?.free_form)
        else if (expenseFilter === 'fixed') list = []
        return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [nonFixedExpenses, expenseFilter])

    // Cumulative inflow per ingredient — walks oldest→newest. Per refill: before = running total, after = +qty.
    const nvlStockSnapshot = useMemo(() => {
        const snapshot = new Map()
        const running = {}
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
    const totalRevenue = useMemo(
        () => allOrders.reduce((s, o) => s + (o.deletedAt ? 0 : (o.total || 0)), 0),
        [allOrders]
    )

    // ─── Action handlers ──────────────────────────────────────────────
    const submitExpense = async () => {
        if (!costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            const amount = Number(costAmount) * 1000
            if (expenseCategory === 'fixed' && fixedSubMode === 'setup') {
                await handleAddFixedCost(costName.trim(), amount)
            } else if (expenseCategory === 'fixed' && fixedSubMode === 'actual') {
                await handleAddExpense(costName.trim(), amount, false, 'cash', {}, true)
            } else {
                // 'expense' — auto-detect Trong ca vs Sau ca from shift_finalized flag
                const today = new Date().toISOString().split('T')[0]
                const isFinalized = selectedAddress?.id && !!localStorage.getItem(`shift_finalized_${selectedAddress.id}_${today}`)
                if (isFinalized) {
                    await handleAddExpense(costName.trim(), amount, true, 'cash', { free_form: true })
                } else {
                    await handleAddExpense(costName.trim(), amount, false, 'cash', {})
                }
            }
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

    const deleteFixed = (id) => {
        setDeletingFixedId(id)
        handleDeleteFixedCost(id).finally(() => setDeletingFixedId(null))
    }

    const deleteExpense = async (id, amount) => {
        setDeletingExpId(id)
        // If the deleted expense was a refill bound to an ingredient, the server-side
        // stock formula (warehouse_stock = Σ refill − Σ restock) will recompute on next
        // fetch — trigger refreshProducts so unit cost / ingredient list stay in sync.
        const target = baseExpenses.find(e => e.id === id)
        const wasInventoryRefill = !!(target?.is_refill && target?.metadata?.ingredient)
        try {
            await handleDeleteExpense(id, amount)
            if (wasInventoryRefill) await refreshProducts?.()
        } finally {
            setDeletingExpId(null)
        }
    }

    const handleReportNav = () => {
        if (scope === 'custom') return // RangeReport for custom range is a follow-up task
        // Tab-switch within the Nhật-ký/Báo-cáo dashboard: use replace so the back button
        // returns to the entry point (e.g. /addresses) instead of cycling through tab toggles.
        const navState = { from: backTo }
        if (scope === 'week' || scope === 'month') {
            navigate(`/range-report?range=${scope}`, { replace: true, state: { ...navState, offset } })
        } else if (offset !== 0) {
            const d = new Date()
            d.setDate(d.getDate() + offset)
            navigate('/daily-report', { replace: true, state: { ...navState, initialDate: d.toISOString().split('T')[0] } })
        } else {
            navigate('/daily-report', { replace: true, state: navState })
        }
    }

    // ─── Render ───────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            <HistoryHeader
                rangeLabel={rangeLabel}
                totalCups={totalCups}
                scope={scope}
                isReadOnly={isReadOnly}
                canGoForward={canGoForward}
                onBack={() => navigate(backTo)}
                onForward={() => navigate('/recipes')}
                activeTab={activeTab}
                onTabSelect={(tab) => {
                    if (tab === 'report') handleReportNav()
                    else setActiveTab(tab)
                }}
                onOffsetPrev={() => setOffset(p => p - 1)}
                onOffsetNext={() => setOffset(p => p + 1)}
                dayInputValue={dayInputValue}
                dayCustomDate={dayCustomDate}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={handlePrevDay}
                onNextDay={handleNextDay}
                onDateChange={handleManualDatePick}
                onEndDatePick={handleDayEndPick}
                hasManualPick={hasManualPick}
                customRange={customRange}
                onCustomStartChange={handleCustomStartChange}
                onCustomEndChange={handleCustomEndChange}
            />

            {activeTab === 'orders' && (
                <OrdersList
                    orders={allOrders}
                    runningTotals={runningTotals}
                    isLoading={isTodayScope ? isLoadingHistory : isLoadingRangeOrders}
                    isTodayScope={isTodayScope}
                    pendingOrders={pendingOrders}
                    isSyncing={isSyncing}
                    onRetrySync={handleRetrySync}
                    onDeleteOffline={handleDeleteOffline}
                    onDeleteOrder={handleDeleteOrder}
                    deletingId={deletingId}
                    setDeletingId={setDeletingId}
                />
            )}

            {activeTab === 'expense' && (
                <ExpensePanel
                    isReadOnly={isReadOnly}
                    isLoading={isLoadingExpenses}
                    expenseFilter={expenseFilter}
                    onSelectFilter={(f) => setExpenseFilter(f)}
                    isManager={isManager}
                    fixedCosts={fixedCosts}
                    editingFixedId={editingFixedId}
                    editFixedName={editFixedName}
                    editFixedAmount={editFixedAmount}
                    deletingFixedId={deletingFixedId}
                    onStartEditFixed={startEditFixed}
                    onCancelEditFixed={() => setEditingFixedId(null)}
                    onSubmitEditFixed={submitEditFixed}
                    onEditFixedNameChange={setEditFixedName}
                    onEditFixedAmountChange={setEditFixedAmount}
                    onDeleteFixed={deleteFixed}
                    fixedPayments={fixedPayments}
                    filteredExpenses={filteredExpenses}
                    ingredientUnits={ingredientUnits}
                    nvlStockSnapshot={nvlStockSnapshot}
                    deletingExpId={deletingExpId}
                    onDeleteExpense={deleteExpense}
                />
            )}

            {/* FAB: Add expense — floating bottom-right, same style as sort button in /recipes */}
            {activeTab === 'expense' && !isReadOnly && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40">
                    <div className="flex justify-end px-4 mb-[72px] pointer-events-auto">
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm"
                        >
                            + Thêm chi phí
                        </button>
                    </div>
                </div>
            )}

            {showAddModal && (
                <AddExpenseModal
                    expenseCategory={expenseCategory}
                    fixedSubMode={fixedSubMode}
                    costName={costName}
                    costAmount={costAmount}
                    isSubmitting={isSubmitting}
                    onClose={() => setShowAddModal(false)}
                    onSubmit={submitExpense}
                    onCategoryChange={setExpenseCategory}
                    onFixedSubModeChange={setFixedSubMode}
                    onNameChange={setCostName}
                    onAmountChange={setCostAmount}
                />
            )}

            <HistoryFooter
                scope={scope}
                isReadOnly={isReadOnly}
                onScopeChange={handleScopeChange}
            />
        </div>
    )
}
