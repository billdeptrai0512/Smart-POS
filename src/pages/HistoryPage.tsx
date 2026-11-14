import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { calculateItemCost, parseVNDInput, formatVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart } from '../utils/reportStats'
import { getPendingOrders, removePendingOrder } from '../hooks/useOfflineSync'
import { dateStringVN, isSameDayVN } from '../utils/dateVN'
import { calcRangeWithLabel } from '../utils/rangeCalc'
import { goToMenuStep } from '../utils/menuSequence'
import { useTabRoute } from '../hooks/useTabRoute'
import { useDateScope } from '../hooks/useDateScope'
import { useHistoryRangeFetch } from '../hooks/useHistoryRangeFetch'
import { useFormatHistoryOrders } from '../hooks/useFormatHistoryOrders'
import { useAddress } from '../contexts/AddressContext'
import { useProducts } from '../contexts/ProductContext'
import { useCart } from '../contexts/CartContext'
import { useStats } from '../contexts/StatsContext'
import { useHistory } from '../contexts/HistoryContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useAuth } from '../contexts/AuthContext'
import { readOnboardingState, writeOnboardingState } from '../utils/onboardingStorage'
import { useOnboardingProgress } from '../hooks/useOnboardingProgress'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import OrdersList from '../components/HistoryPage/OrdersList'
import { onboardingHintClass } from '../utils/onboardingHint'
import SalesCard from '../components/DailyReportPage/SalesCard'
import ExpensePanel from '../components/HistoryPage/ExpensePanel'
import AddExpenseModal from '../components/HistoryPage/AddExpenseModal'
import { shiftFinalizedKey, cashClosedKey } from '../constants/storageKeys'
import { Plus } from 'lucide-react'
import { useExpenseCategories } from '../hooks/useExpenseCategories'
import { buildExpenseUpdates } from '../utils/expenseUpdates'
import Toast from '../components/POSPage/Toast'
import type { CartExtra, Row } from '../types/domain'

export default function HistoryPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { addressId } = useAddress()
    const confirm = useConfirm()
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, refreshProducts } = useProducts()
    const {
        todayOrders, todayExpenses, isLoadingHistory, justArrivedIds,
        handleDeleteOrder, handleUpdateOrderDiscount, handleAddExpense, handleUpdateExpense, handleDeleteExpense, handleLoadHistory,
    } = useHistory()
    const { retrySync } = useStats()
    const { toast, showToast } = useCart()
    const { isGuest, profile } = useAuth()

    useEffect(() => {
        if (!isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Onboarding: "Xem nhật ký" only counts once step "Bán hàng" is done (order sent — see
    // onboarding/steps.ts); visiting /history before that doesn't tick it, so the order
    // matters, not just "has this page ever been opened".
    useEffect(() => {
        if (!isGuest || !addressId) return
        const { orderProgress } = readOnboardingState(addressId)
        if (!orderProgress.viewedHistory && orderProgress.sent >= 1) {
            writeOnboardingState(addressId, { orderProgress: { ...orderProgress, viewedHistory: true } })
        }
    }, [isGuest, addressId])

    // ─── Navigation state ─────────────────────────────────────────────
    const expensesToView: Row[] | undefined = location.state?.expensesToView  // read-only past date list
    const isReadOnly = location.state?.isReadOnly || false
    const backTo = location.state?.from || '/pos'

    // ─── UI state ─────────────────────────────────────────────────────
    // Tab nằm trên URL: /history/sales · /history/expense.
    const [activeTab, setActiveTab] = useTabRoute('/history')
    const [showAddModal, setShowAddModal] = useState(false)

    // Onboarding phase 2 "Nhật ký": một việc duy nhất — sang Báo cáo (viewedReport, ghi ở nút "tiến" bên dưới). Chỉ tính khi bước "Bán hàng" đã xong.
    const orderStored = useOnboardingProgress('orderProgress', { isGuest, addressId })
    const orderDone = orderStored.sent >= 1
    const journalProgress = useOnboardingProgress('journalProgress', { isGuest, addressId })
    // Hint: mũi tên "tiến" sang trang Báo cáo (Báo cáo là trang riêng).
    const journalHint = !(isGuest && orderDone) ? null : !journalProgress.viewedReport ? 'report' : null
    // Nhịp guide: dải chữ gõ xong (~0,8s) → thẻ thống kê sáng kiểu "nhìn vào đây" 2s → mũi tên "tiến" mới sáng.
    const [forwardReady, setForwardReady] = useState(false)
    useEffect(() => {
        if (journalHint !== 'report') return
        const t = setTimeout(() => setForwardReady(true), 2800)
        return () => clearTimeout(t)
    }, [journalHint])

    // Date selection (scope/offset/customRange + handlers) lives in the shared
    // hook so /history and /report stay in lock-step. Seeded from nav state
    // so a window survives the Nhật ký ↔ Báo cáo tab switch.
    const date = useDateScope(location.state)
    const {
        scope, offset, customRange,
        todayISO, dayInputValue, canGoForwardDay, canGoForwardPeriod, navState: dateNavState,
        goPrevDay, goNextDay, goOffsetPrev, goOffsetNext,
        applyRange, shiftRange, canShiftRangeForward, applyPreset,
    } = date

    // ─── Orders state ─────────────────────────────────────────────────
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [pendingOrders, setPendingOrders] = useState(() => getPendingOrders())
    const [isSyncing, setIsSyncing] = useState(false)

    // ─── Add-expense form state ───────────────────────────────────────
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [expenseDate, setExpenseDate] = useState(() => dateStringVN()) // ngày chi, default hôm nay
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
    // Tải lại mỗi lần mở modal: thẻ chi phí cũng cần nhãn để vẽ chip nên không chỉ gắn với lúc modal mở.
    const { categories: expenseCategories, actions: categoryActions } = useExpenseCategories(addressId, showAddModal)
    const [isAfterShift, setIsAfterShift] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState('cash')
    // null = đang TẠO mới; có object = đang SỬA chi phí đó (modal prefill từ thẻ).
    const [editingExpense, setEditingExpense] = useState<Row | null>(null)

    // Auto-pick a default category khi mở modal mà CHƯA có nhãn nào chọn. KHÔNG
    // re-pick theo nhóm legacy nữa: việc đổi Phân loại (group) + chọn nhãn đầu của
    // nhóm mới do dropdown trong AddExpenseModal đảm nhiệm. Effect cũ map về
    // operating/overhead làm nhãn nhóm Tồn kho / Ngoài kinh doanh bị ghi đè ngược.
    useEffect(() => {
        if (!showAddModal || expenseCategories.length === 0) return
        const current = expenseCategories.find(c => c.id === selectedCategoryId)
        if (current) return // đã có nhãn hợp lệ (bất kể nhóm) → giữ nguyên
        const fallback =
            expenseCategories.find(c => c.is_default && c.group_section === 'operating' && c.name === 'Chi phí khác')
            || expenseCategories.find(c => c.group_section === 'operating')
            || expenseCategories[0]
            || null
        setSelectedCategoryId(fallback?.id || null)
    }, [showAddModal, expenseCategories, selectedCategoryId])

    // Reset form when modal closes; seed isAfterShift from current finalized state.
    // KHÔNG đụng khi đang SỬA — openEditExpense đã prefill từ thẻ chi phí.
    useEffect(() => {
        if (!showAddModal) {
            setCostName('')
            setCostAmount('')
            setSelectedCategoryId(null)
            setExpenseDate(dateStringVN())
            setIsAfterShift(false)
            setPaymentMethod('cash')
            setEditingExpense(null)
        } else if (!editingExpense) {
            // Default toggle to "Sau chốt ca" when shift or cash is already closed
            const today = dateStringVN()
            const finalized = addressId && (
                !!localStorage.getItem(shiftFinalizedKey(addressId, today)) ||
                !!localStorage.getItem(cashClosedKey(addressId, today))
            )
            setIsAfterShift(!!finalized)
        }
    }, [showAddModal, addressId]) // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Range fetch ──────────────────────────────────────────────────
    const { rangeStart, rangeEnd, rangeLabel } = useMemo(() => {
        const { start, end, label } = calcRangeWithLabel(scope, offset, customRange)
        return { rangeStart: start, rangeEnd: end, rangeLabel: label }
    }, [scope, offset, customRange])

    const isTodayScope = scope === 'day' && offset === 0
    // Nhiều ngày → biểu đồ cột theo thứ (DayPerformanceChart); 1 ngày → biểu đồ theo giờ trong SalesCard.
    const isRangeScope = scope === 'week' || scope === 'month' || (scope === 'custom' && !isSameDayVN(rangeStart, rangeEnd))

    // ─── Range data fetchers ──────────────────────────────────────────
    const { rangeExpenses, rangeOrders, isLoadingRange, isLoadingRangeOrders, patchExpense: patchRangeExpense, patchOrder: patchRangeOrder } = useHistoryRangeFetch({
        addressId,
        rangeStart, rangeEnd,
        isTodayScope, isReadOnly,
    })

    // Move ONE expense to another label (re-tag). Patches both the today list
    // (via POS handler) and the range list so the moved card shows its new tag
    // immediately; report cards refetch on their own via cache invalidation.
    const updateExpense = useCallback(async (expenseId: string, patch: Parameters<typeof handleUpdateExpense>[1]) => {
        await handleUpdateExpense(expenseId, patch)
        if (!isTodayScope && patchRangeExpense) patchRangeExpense(expenseId, patch)
    }, [handleUpdateExpense, isTodayScope, patchRangeExpense])
    const handleMoveExpense = useCallback(
        (expenseId: string, toId: string) => updateExpense(expenseId, { category_id: toId }),
        [updateExpense]
    )

    // Xem tuần/tháng thì danh sách đơn nằm trong rangeOrders, không phải todayOrders mà context vá —
    // vá thêm ở đây để thẻ đổi ngay thay vì đứng yên tới khi đổi khoảng ngày.
    const deleteOrder = useCallback(async (id: string) => {
        const ok = await handleDeleteOrder(id)
        if (ok && !isTodayScope) patchRangeOrder(id, { deleted_at: new Date().toISOString(), deleted_by: profile?.name })
        return ok
    }, [handleDeleteOrder, isTodayScope, patchRangeOrder, profile?.name])

    const updateOrderDiscount = useCallback(async (orderId: string, total: number, discountAmount: number, itemDiscounts: { id: string; discount_amount: number }[] = []) => {
        const ok = await handleUpdateOrderDiscount(orderId, total, discountAmount, itemDiscounts)
        if (!ok || isTodayScope) return
        const byId = new Map(itemDiscounts.map(d => [d.id, d.discount_amount]))
        const items = rangeOrders.find(o => o.id === orderId)?.order_items || []
        patchRangeOrder(orderId, {
            total, discount_amount: discountAmount,
            order_items: items.map((i: Row) => byId.has(i.id) ? { ...i, discount_amount: byId.get(i.id) } : i),
        })
    }, [handleUpdateOrderDiscount, isTodayScope, patchRangeOrder, rangeOrders])

    // ─── Offline order sync ───────────────────────────────────────────
    const refreshPending = useCallback(() => setPendingOrders(getPendingOrders()), [])

    const handleDeleteOffline = useCallback(async (createdAt: string) => {
        if (!await confirm({ title: 'Xóa đơn offline này khỏi máy?', danger: true, confirmLabel: 'Xóa' })) return
        removePendingOrder(createdAt)
        refreshPending()
    }, [refreshPending, confirm])

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
    const getItemCost = useCallback((productId: string, extras: Row[] | undefined, snapshotUnitCost = 0) => {
        if (snapshotUnitCost > 0) return snapshotUnitCost
        return calculateItemCost(productId, (extras || []) as CartExtra[], recipes, extraIngredients, ingredientCosts)
    }, [recipes, extraIngredients, ingredientCosts])

    const baseOrders = isTodayScope ? (todayOrders || []) : rangeOrders
    const productCountMap = useMemo(() => new Map((products || []).map(p => [p.id, p.count_as_cup !== false])), [products])
    // Nhiều ngày: cùng biểu đồ cột của SalesCard nhưng mỗi cột là 1 THỨ (T2..CN) gộp cả kỳ, thay cho cột giờ.
    const weekdayChartData = useMemo(() => {
        const days = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
        const slots = days.map(() => ({ revenue: 0, cups: 0, items: {} as Record<string, number> }))
        for (const o of baseOrders) {
            if (o.deleted_at) continue
            const s = slots[(new Date(o.created_at).getDay() + 6) % 7]
            s.revenue += o.total || 0
            for (const it of o.order_items || []) {
                const qty = it.quantity || 1
                if (productCountMap.get(it.product_id) !== false) s.cups += qty
                const name = it.products?.name
                if (name) s.items[name] = (s.items[name] || 0) + qty
            }
        }
        return slots.map((s, i) => {
            const items = Object.entries(s.items).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty)
            return { hour: days[i], hourRevenue: s.revenue, items, cups: s.cups }
        })
    }, [baseOrders, productCountMap])

    // PERF: index products by id once (was: products?.find() inside every order's item map).
    const productById = useMemo(() => {
        const m = new Map<string, Row>()
        for (const p of products || []) m.set(p.id, p)
        return m
    }, [products])

    const { allOrders } = useFormatHistoryOrders({
        baseOrders, pendingOrders, productById, getItemCost, isTodayScope,
    })

    const totalCups = useMemo(() => allOrders.reduce((sum, o) => {
        if (!o.items || o.deletedAt) return sum
        return sum + o.items.reduce((itemSum, item) => {
            if (item.productId && productCountMap.get(item.productId) === false) return itemSum
            return itemSum + (item.quantity || 0)
        }, 0)
    }, 0), [allOrders, productCountMap])

    const totalRevenue = useMemo(() => allOrders.reduce((sum, o) => o.deletedAt ? sum : sum + o.total, 0), [allOrders])

    // Bảng "Trong đó" + biểu đồ giờ của SalesCard. Không dùng giá vốn nên không cần công thức/giá NVL.
    const { productStats, soldProducts, lineChartData } = useMemo(() => {
        const extraMaps = buildExtraMaps(productExtras)
        const agg = aggregateOrderStats({
            orders: [...baseOrders, ...(isTodayScope ? pendingOrders : [])],
            productMap: productById,
            extraPriceMap: extraMaps.priceMap,
            extraNameMap: extraMaps.nameMap,
            recipes: [], extraIngredients: {}, ingredientCosts: {},
        })
        return { productStats: agg.productStats, soldProducts: agg.soldProducts, lineChartData: buildHourlyLineChart(agg) }
    }, [baseOrders, pendingOrders, isTodayScope, productById, productExtras])

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
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
        [baseExpenses]
    )

    const isLoadingExpenses = !isReadOnly && (isTodayScope ? isLoadingHistory : isLoadingRange)

    // ─── Action handlers ──────────────────────────────────────────────
    // "Thực chi" only: mọi chi phí đều là expense thực được ghi nhận tại
    // thời điểm chi tiêu. Tab chỉ quyết định group_section qua tag (operating
    // vs overhead) — không còn fixed_costs template / auto-inject.
    // Mở modal ở chế độ SỬA — prefill mọi field từ thẻ chi phí.
    const openEditExpense = useCallback((expense: Row) => {
        setEditingExpense(expense)
        setCostName(expense.name || '')
        setCostAmount(formatVNDInput(String(expense.amount ?? '')))
        setExpenseDate(dateStringVN(new Date(expense.created_at)))
        setIsAfterShift(!!expense.metadata?.free_form)
        setPaymentMethod(expense.payment_method || 'cash')
        setSelectedCategoryId(expense.category_id || null)
        setShowAddModal(true)
    }, [])

    const submitExpense = async () => {
        const amount = parseVNDInput(costAmount)
        if (amount <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            const today = dateStringVN()
            // Phase: "Sau chốt ca" lưu is_refill=true + metadata.free_form; "Trong ca" thì không.
            const metadata = isAfterShift ? { free_form: true } : {}

            if (editingExpense) {
                await updateExpense(editingExpense.id, buildExpenseUpdates(editingExpense, {
                    name: costName, amount, paymentMethod, categoryId: selectedCategoryId, date: expenseDate, isAfterShift,
                }))
                setShowAddModal(false)
                return
            }

            // TẠO mới — backdate: anchor noon VN; null = today → server NOW() giữ giờ thật.
            const isBackdated = expenseDate && expenseDate !== today
            const createdAt = isBackdated ? new Date(`${expenseDate}T12:00:00+07:00`).toISOString() : null
            await handleAddExpense(costName.trim(), amount, isAfterShift, paymentMethod, metadata, false, selectedCategoryId, createdAt)
            setShowAddModal(false)
        } catch { /* lỗi đã được context surface qua toast */ }
        finally { setIsSubmitting(false) }
    }

    // Xoá từ trong modal sửa.
    const deleteEditingExpense = async () => {
        if (!editingExpense) return
        if (!await confirm({ title: `Xóa chi phí "${editingExpense.name}"?`, detail: 'Hành động này không thể hoàn tác!', danger: true, confirmLabel: 'Xóa' })) return
        // If the deleted expense was a refill bound to an ingredient, the server-side
        // stock formula (warehouse_stock = Σ refill − Σ restock) will recompute on next
        // fetch — trigger refreshProducts so unit cost / ingredient list stay in sync.
        const { id, amount, is_refill, metadata } = editingExpense
        await handleDeleteExpense(id, amount)
        if (is_refill && metadata?.ingredient) await refreshProducts?.()
        setShowAddModal(false)
    }

    const handleForward = () => {
        // Phase 2 "Nhật ký" hoàn tất khi user tự bấm mũi tên sang trang Báo cáo (điều hướng đi
        // luôn nên không có effect nào bắt được như 2 tab kia — ghi thẳng ở đây).
        // dateNavState ({ scope, offset, customRange }) carries the full window so
        // /report opens on the same selection instead of resetting to "hôm nay".
        if (isGuest && addressId && orderDone && !journalProgress.viewedReport) {
            writeOnboardingState(addressId, { journalProgress: { ...journalProgress, viewedReport: true } })
        }
        goToMenuStep(activeTab, +1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard })
    }

    // ─── Render ───────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full max-w-lg lg:max-w-none mx-auto bg-bg">
            <HistoryHeader
                rangeLabel={rangeLabel}
                totalCups={totalCups}
                scope={scope}
                isReadOnly={isReadOnly}
                canGoForward={canGoForwardPeriod}
                onBack={() => goToMenuStep(activeTab, -1, { navigate, backTo, wizard: location.state?.wizard })}
                onForward={handleForward}
                hintForward={journalHint === 'report' && forwardReady}
                activeTab={activeTab}
                onTabSelect={setActiveTab}
                onOffsetPrev={goOffsetPrev}
                onOffsetNext={goOffsetNext}
                rangeStartISO={rangeStart ? dateStringVN(rangeStart) : undefined}
                rangeEndISO={rangeEnd ? dateStringVN(rangeEnd) : undefined}
                dayInputValue={dayInputValue}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={goPrevDay}
                onNextDay={goNextDay}
                customRange={customRange}
                onRangeChange={applyRange}
                onShiftRange={shiftRange}
                canShiftRangeForward={canShiftRangeForward}
                onPresetSelect={applyPreset}
            />

            {activeTab === 'sales' && (
                <OrdersList
                    orders={allOrders}
                    summary={
                        <SalesCard
                            totalCups={totalCups}
                            products={products}
                            soldProducts={soldProducts}
                            totalRevenue={totalRevenue}
                            productStats={productStats}
                            lineChartData={isRangeScope ? weekdayChartData : lineChartData}
                            className={`${onboardingHintClass(journalHint === 'report', 'look')} [--look-delay:0.8s]`}
                        />
                    }
                    isLoading={isTodayScope ? isLoadingHistory : isLoadingRangeOrders}
                    isTodayScope={isTodayScope}
                    justArrivedIds={isTodayScope ? justArrivedIds : null}
                    pendingOrders={pendingOrders}
                    isSyncing={isSyncing}
                    onRetrySync={handleRetrySync}
                    onDeleteOffline={handleDeleteOffline}
                    onDeleteOrder={deleteOrder}
                    onUpdateDiscount={updateOrderDiscount}
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
                    onEditExpense={openEditExpense}
                />
            )}

            {/* FAB: Add expense — floating bottom-right, matching the /category & /inventory
                FAB position (the date-picker footer is gone, so it sits flush to the bottom). */}
            {activeTab === 'expense' && !isReadOnly && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg lg:max-w-[1280px] mx-auto pointer-events-none z-50">
                    <div className="flex justify-end px-4 lg:px-8 pb-[max(env(safe-area-inset-bottom),16px)] [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),28px)] pointer-events-auto">
                        <button
                            onClick={() => { if (scope === 'day') setExpenseDate(dayInputValue); setShowAddModal(true) }}
                            aria-label="Thêm chi phí"
                            className="bg-danger rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold uppercase tracking-wider text-bg hover:bg-danger/90 active:scale-95 transition-all shadow-sm"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
            )}

            {showAddModal && (
                <AddExpenseModal
                    isEditing={!!editingExpense}
                    onDelete={deleteEditingExpense}
                    costName={costName}
                    costAmount={costAmount}
                    isSubmitting={isSubmitting}
                    isAfterShift={isAfterShift}
                    onAfterShiftChange={setIsAfterShift}
                    expenseCategories={expenseCategories}
                    selectedCategoryId={selectedCategoryId}
                    onCategoryIdChange={setSelectedCategoryId}
                    {...categoryActions}
                    onMoveExpense={handleMoveExpense}
                    showToast={showToast}
                    onClose={() => setShowAddModal(false)}
                    onSubmit={submitExpense}
                    onNameChange={setCostName}
                    onAmountChange={setCostAmount}
                    expenseDate={expenseDate}
                    onDateChange={setExpenseDate}
                    paymentMethod={paymentMethod}
                    onPaymentMethodChange={setPaymentMethod}
                />
            )}

            {/* Toast tự có z-[300] — trên modal/sheet (z-[100]) nên nút Hoàn tác vẫn bấm được. */}
            <Toast toast={toast} />
        </div>
    )
}
