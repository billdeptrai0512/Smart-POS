import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateProductCost, parseVNDInput } from '../utils'
import { getPendingOrders, removePendingOrder } from '../hooks/useOfflineSync'
import { dateStringVN, isSameDayVN } from '../utils/dateVN'
import { calcRangeWithLabel, offsetFromISO, dayCustomDateOf } from '../utils/rangeCalc'
import { applyPresetToScope } from '../components/common/datePickerUtils'
import { useHistoryRangeFetch } from '../hooks/useHistoryRangeFetch'
import { useFormatHistoryOrders } from '../hooks/useFormatHistoryOrders'
import { useAddress } from '../contexts/AddressContext'
import { useProducts } from '../contexts/ProductContext'
import { usePOS } from '../contexts/POSContext'
import { useAuth } from '../contexts/AuthContext'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import OrdersList from '../components/HistoryPage/OrdersList'
import ExpensePanel from '../components/HistoryPage/ExpensePanel'
import AddExpenseModal from '../components/HistoryPage/AddExpenseModal'
import HistoryFooter from '../components/HistoryPage/HistoryFooter'
import { shiftFinalizedKey } from '../constants/storageKeys'
import { Plus } from 'lucide-react'
import { fetchExpenseCategories, insertExpenseCategory, updateExpenseCategory, deleteExpenseCategory } from '../services/expenseService'

// Use dateStringVN so YYYY-MM-DD always reflects Vietnam local date,
// regardless of where the browser runs.
const getLocalISO = (date = new Date()) => dateStringVN(date)

export default function HistoryPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { selectedAddress } = useAddress()
    const { products, recipes, ingredientCosts, extraIngredients, refreshProducts } = useProducts()
    const {
        todayOrders, todayExpenses, isLoadingHistory,
        handleDeleteOrder, handleAddExpense, handleUpdateExpense, handleDeleteExpense, handleLoadHistory, retrySync,
        refreshTodayExpenses,
    } = usePOS()
    const { isManager: isManagerRole, isAdmin, profile } = useAuth()
    const isManager = isManagerRole || isAdmin

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ─── Navigation state ─────────────────────────────────────────────
    const initialTab = location.state?.tab === 'expense' ? 'expense' : 'orders'
    const expensesToView = location.state?.expensesToView  // read-only past date list
    const isReadOnly = location.state?.isReadOnly || false
    const backTo = location.state?.from || '/pos'
    // Scope/offset hand-off from RangeReport footer (Tuần/Tháng) so the manager keeps
    // their date window when toggling tabs.
    const initialScope = ['day', 'week', 'month'].includes(location.state?.scope) ? location.state.scope : 'day'
    const initialOffset = typeof location.state?.offset === 'number' ? location.state.offset : 0

    // ─── UI state ─────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState(initialTab)
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

    // ─── Add-expense form state ───────────────────────────────────────
    // `expenseCategory` here = top tab. 'expense' → Vận hành (operating tags),
    // 'fixed' → Quản lý & khác (overhead tags). The legacy 'fixed' key is kept
    // to avoid touching scattered handlers; semantically it now drives only
    // group_section, not the fixed_costs template flow (which is deprecated).
    const [expenseCategory, setExpenseCategory] = useState('expense')
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [selectedCategoryId, setSelectedCategoryId] = useState(null)
    const [expenseCategories, setExpenseCategories] = useState([])

    // Fetch tags on mount + whenever the modal opens (cache-backed). Card list
    // also needs categories to resolve the tag chip on each ExpenseCard, so we
    // can't gate solely on modal open.
    useEffect(() => {
        if (!selectedAddress?.id) return
        fetchExpenseCategories(selectedAddress.id).then(setExpenseCategories)
    }, [selectedAddress?.id, showAddModal])

    // Auto-pick a sensible default category whenever the modal opens or the top
    // tab switches. Switching Vận hành ↔ Quản lý & khác MUST reset the selection
    // to a tag in the new group — otherwise the picker shows a chip that's
    // hidden from the filtered list, leaving the user with no visible selection.
    useEffect(() => {
        if (!showAddModal || expenseCategories.length === 0) return
        const targetGroup = expenseCategory === 'fixed' ? 'overhead' : 'operating'
        const current = expenseCategories.find(c => c.id === selectedCategoryId)
        if (current && current.group_section === targetGroup) return
        const fallback =
            expenseCategories.find(c => c.is_default && c.group_section === targetGroup && c.name === 'Chi phí khác')
            || expenseCategories.find(c => c.group_section === targetGroup)
            || null
        setSelectedCategoryId(fallback?.id || null)
    }, [showAddModal, expenseCategories, selectedCategoryId, expenseCategory])

    // Reset form when modal closes
    useEffect(() => {
        if (!showAddModal) {
            setCostName('')
            setCostAmount('')
            setExpenseCategory('expense')
            setSelectedCategoryId(null)
        }
    }, [showAddModal])

    const handleCreateCategory = useCallback(async ({ name, group_section }) => {
        if (!selectedAddress?.id) return null
        const created = await insertExpenseCategory(selectedAddress.id, { name, group_section })
        setExpenseCategories(prev => [...prev, created])
        return created
    }, [selectedAddress?.id])

    const handleUpdateCategory = useCallback(async (id, updates) => {
        const updated = await updateExpenseCategory(id, updates)
        setExpenseCategories(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
        return updated
    }, [])

    const handleDeleteCategoryTag = useCallback(async (id) => {
        await deleteExpenseCategory(id)
        setExpenseCategories(prev => prev.filter(c => c.id !== id))
        // Note: existing expenses still hold this category_id. FinanceCards +
        // TagPill fall back to "Chưa phân loại" / "Chi phí khác" via lookup miss.
        // Manager can re-tag them via the sheet if needed.
    }, [])

    // ─── Range fetch ──────────────────────────────────────────────────
    const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
        const { start, end, label } = calcRangeWithLabel(scope, offset, customRange)
        return { rangeStart: start, rangeEnd: end, rangeLabel: label }
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

    // Unified calendar emits {startISO, endISO}. Equal endpoints = single day →
    // day scope via offset; different = real range → custom scope. End clamped to today.
    const handleRangeChange = ({ startISO, endISO }) => {
        if (!startISO || !endISO) return
        const today = getLocalISO(new Date())
        const safeEnd = endISO > today ? today : endISO
        const safeStart = startISO > safeEnd ? safeEnd : startISO
        if (safeStart === safeEnd) {
            setCustomRange(null)
            setScope('day')
            setHasManualPick(true)
            setOffsetFromISO(safeStart)
        } else {
            setCustomRange({ startISO: safeStart, endISO: safeEnd })
            setHasManualPick(false)
            setScope('custom')
        }
    }

    // ─── Day-mode date picker ─────────────────────────────────────────
    const todayISO = getLocalISO(new Date())
    const dayCustomDate = useMemo(() => dayCustomDateOf(scope, offset), [scope, offset])
    const dayInputValue = dayCustomDate || todayISO
    const canGoForwardDay = dayInputValue < todayISO

    const setOffsetFromISO = (iso) => {
        if (!iso || iso >= todayISO) { setOffset(0); setHasManualPick(false); return }
        setOffset(offsetFromISO(iso, todayISO))
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


    // ─── Range data fetchers ──────────────────────────────────────────
    const { rangeExpenses, rangeOrders, isLoadingRange, isLoadingRangeOrders, patchExpense: patchRangeExpense } = useHistoryRangeFetch({
        addressId: selectedAddress?.id,
        rangeStart, rangeEnd,
        isTodayScope, isReadOnly,
    })

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
    // Stable callback so downstream useMemos don't bust on every render.
    // snapshotUnitCost > 0 means the cost was frozen on the DB row at sale time —
    // honor it instead of recomputing from current recipes/prices.
    const getItemCost = useCallback((productId, extras, snapshotUnitCost) => {
        if (snapshotUnitCost > 0) return snapshotUnitCost
        return calculateProductCost(productId, extras || [], recipes, extraIngredients, ingredientCosts)
    }, [recipes, extraIngredients, ingredientCosts])

    const baseOrders = isTodayScope ? (todayOrders || []) : rangeOrders

    // PERF: index products by id once (was: products?.find() inside every order's item map).
    const productById = useMemo(() => {
        const m = new Map()
        for (const p of products || []) m.set(p.id, p)
        return m
    }, [products])

    const { formattedOnline, formattedOffline, allOrders } = useFormatHistoryOrders({
        baseOrders, pendingOrders, productById, getItemCost, isTodayScope,
    })

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

    // Expense list shown in /history excludes NVL refills — biến động kho mỗi
    // nguyên liệu sống ở /ingredient/:id. NVL vẫn xuất hiện trong dòng tiền
    // (CashFlowCard) vì là cash-out thật, chỉ không trừ lại trong P&L.
    // Free-form refills (chi linh tinh sau ca) vẫn là expense thường → giữ lại.
    const expensesForList = useMemo(
        () => baseExpenses
            .filter(e => !e.is_refill || e.metadata?.free_form)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        [baseExpenses]
    )

    const isLoadingExpenses = isReadOnly ? false : (isTodayScope ? isLoadingHistory : isLoadingRange)
    const totalRevenue = useMemo(
        () => allOrders.reduce((s, o) => s + (o.deletedAt ? 0 : (o.total || 0)), 0),
        [allOrders]
    )

    // ─── Action handlers ──────────────────────────────────────────────
    // "Thực chi" only: mọi chi phí đều là expense thực được ghi nhận tại
    // thời điểm chi tiêu. Tab chỉ quyết định group_section qua tag (operating
    // vs overhead) — không còn fixed_costs template / auto-inject.
    const submitExpense = async () => {
        const amount = parseVNDInput(costAmount)
        if (amount <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            const tagId = selectedCategoryId || null
            // Auto-detect Trong ca vs Sau ca from shift_finalized flag — vẫn cần
            // để ExpensePanel badge phân biệt "Sau ca" cho expense vận hành.
            const today = new Date().toISOString().split('T')[0]
            const isFinalized = selectedAddress?.id && !!localStorage.getItem(shiftFinalizedKey(selectedAddress.id, today))
            // Always insert as cash; user toggles payment on the row card after.
            if (isFinalized) {
                await handleAddExpense(costName.trim(), amount, true, 'cash', { free_form: true }, false, tagId)
            } else {
                await handleAddExpense(costName.trim(), amount, false, 'cash', {}, false, tagId)
            }
            setShowAddModal(false)
        } catch { }
        finally { setIsSubmitting(false) }
    }

    const changeExpenseCategory = useCallback(async (expenseId, newCategoryId) => {
        // POSContext.handleUpdateExpense patches todayExpenses + invalidates daily cache.
        // For non-today scopes we also patch the range fetch cache so the card
        // re-renders immediately without an extra round-trip.
        await handleUpdateExpense(expenseId, { category_id: newCategoryId })
        if (!isTodayScope && patchRangeExpense) {
            patchRangeExpense(expenseId, { category_id: newCategoryId })
        }
    }, [handleUpdateExpense, isTodayScope, patchRangeExpense])

    const changeExpensePayment = useCallback(async (expenseId, newPaymentMethod) => {
        // Affects CashFlowCard's cash/transfer split + cuối kỳ "thực thu" math, so
        // patching both the local list and the range cache is critical for the
        // dashboards above to recompute when manager flips this.
        await handleUpdateExpense(expenseId, { payment_method: newPaymentMethod })
        if (!isTodayScope && patchRangeExpense) {
            patchRangeExpense(expenseId, { payment_method: newPaymentMethod })
        }
    }, [handleUpdateExpense, isTodayScope, patchRangeExpense])

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
            navigate('/daily-report', { replace: true, state: { ...navState, scope, offset } })
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
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={handlePrevDay}
                onNextDay={handleNextDay}
                customRange={customRange}
                onRangeChange={handleRangeChange}
                onPresetSelect={(preset) => applyPresetToScope(preset, { setScope, setOffset, setHasManualPick, setCustomRange })}
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
                    expenses={expensesForList}
                    expenseCategories={expenseCategories}
                    deletingExpId={deletingExpId}
                    onDeleteExpense={deleteExpense}
                    onChangeCategory={changeExpenseCategory}
                    onCreateCategory={handleCreateCategory}
                    onUpdateCategory={handleUpdateCategory}
                    onDeleteCategoryTag={handleDeleteCategoryTag}
                    onChangePayment={changeExpensePayment}
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
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
            )}

            {showAddModal && (
                <AddExpenseModal
                    expenseCategory={expenseCategory}
                    costName={costName}
                    costAmount={costAmount}
                    isSubmitting={isSubmitting}
                    expenseCategories={expenseCategories}
                    selectedCategoryId={selectedCategoryId}
                    onCategoryIdChange={setSelectedCategoryId}
                    onCreateCategory={handleCreateCategory}
                    onClose={() => setShowAddModal(false)}
                    onSubmit={submitExpense}
                    onCategoryChange={setExpenseCategory}
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
