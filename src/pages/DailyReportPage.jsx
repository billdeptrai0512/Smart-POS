import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { formatVNDInput, parseVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, buildHourlyLineChart, splitExpenses } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchIngredientStocks, invalidateDailyContext, editIngredientRestock, fetchIngredientRestockHistory, insertShiftClosing, updateShiftClosing } from '../services/orderService'
import { buildCashPayload } from '../services/reportService'
import { useIngredientCatalog } from '../hooks/useIngredientCatalog'
import { useDailyReportData } from '../hooks/useDailyReportData'
import { calculateEstimatedConsumption, splitCogsByCategory, calculateLossValue, buildRecipeIngredientSet, isLiveOrder, openingSeed } from '../utils/inventory'
import { estimateOpeningStocks, recipesBelongTo } from '../services/counterEstimate'
import { useCounterCalc } from '../hooks/useCounterCalc'
import { ingredientLabel, getIngredientUnit } from '../utils/ingredients'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, isCashFlowProgressDone, isInventoryProgressDone, reachedCashCard } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { isRecipeStepActive } from '../components/common/onboarding/steps'
import { dateStringVN, timeStringVN, isSameDayVN, dateShortVN, dateFullVN } from '../utils/dateVN'
import { useDateScope } from '../hooks/useDateScope'
import { goToMenuStep } from '../utils/menuSequence'
import { useTabRoute } from '../hooks/useTabRoute'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
import SalesCard from '../components/DailyReportPage/SalesCard'
import CashFlowCard from '../components/DailyReportPage/CashFlowCard'
import ExpenseEditorModal from '../components/DailyReportPage/ExpenseEditorModal'
import FinanceCards from '../components/DailyReportPage/FinanceCards'
import { fetchExpenseCategories } from '../services/expenseService'
import SupportModal from '../components/common/SupportModal'
import ReportViewFilter, { VIEW_ALL, VIEW_PROFIT, VIEW_CASHFLOW } from '../components/DailyReportPage/ReportViewFilter'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useEntitlement } from '../hooks/useEntitlement'
import Toast from '../components/POSPage/Toast'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import { cashClosedKey } from '../constants/storageKeys'
import { useShiftFinalized } from '../hooks/useShiftFinalized'
import DayPerformanceChart from '../components/DailyReportPage/DayPerformanceChart'

// Pill cuối trang (Hỗ trợ / góp ý · In báo cáo).
const FOOT_BTN = 'px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 cursor-pointer text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap text-primary'

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history/sales'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, refreshTodayExpenses } = useHistory()
    const { isStaff, profile, isGuest } = useAuth()
    const { hasAccess, loading: entitlementLoading, enabled: monetizationEnabled } = useEntitlement()
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    // ── All hooks unconditional (Rules of Hooks) ──────────────────────────────
    // Tab nằm trên URL: /report/cashflow · /report/revenue (Lợi nhuận — staff không xem được).
    const [tabParam, setView] = useTabRoute('/report')
    const view = isStaff && tabParam === VIEW_PROFIT ? VIEW_CASHFLOW : tabParam
    // Mỗi view là 1 "trang" riêng → đổi view thì cuộn lại đầu (cùng 1 <main> nên scroll bị dính).
    const mainRef = useRef(null)
    useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [view])
    const [showSupportModal, setShowSupportModal] = useState(false)
    const { selectedAddress } = useAddress()
    const initialDate = location.state?.initialDate || null

    // Date selection (scope/offset/customRange + every transition handler) lives in
    // the shared hook so /report and /history stay in lock-step. Seeded from
    // nav state so a week/month/custom window survives the Nhật ký ↔ Báo cáo switch.
    const {
        scope, offset, customRange,
        dayInputValue, canGoForwardDay, canGoForwardPeriod, navState: dateNavState,
        goPrevDay, goNextDay, goOffsetPrev, goOffsetNext,
        applyRange, shiftRange, canShiftRangeForward, applyPreset, goToDate,
    } = useDateScope(location.state)


    // Deep-link: open on a specific past date passed via nav state (e.g. from a
    // "xem ngày X" link). Runs once; the hook clamps future dates to today.
    useEffect(() => {
        if (initialDate && initialDate !== dateStringVN(new Date())) goToDate(initialDate)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialDate])

    // All server-data state (shift closing, yesterday comparison, range data,
    // todayISO midnight rollover) lives in useDailyReportData. setShiftClosing
    // is exposed so save handlers can patch it inline after a write.
    const {
        todayISO,
        isTodayScope,
        rangeStart, rangeEnd,
        shiftClosing, setShiftClosing,
        yesterdayClosing,
        apiOrders,
        apiExpenses, setApiExpenses,
        apiPayments,
        todayPayments,
        apiShiftClosings,
        prevShiftClosings,
        isAsyncReady,
        refetch: refetchReport,
    } = useDailyReportData({
        addressId: selectedAddress?.id,
        scope, offset, customRange,
        onError: showError,
    })

    // Inline cash/transfer editor (today scope only). Pre-fills from shiftClosing when
    // it loads; cashDirty is derived from input vs. persisted so reverting the change
    // makes the Lưu button disappear again.
    const [cashInput, setCashInput] = useState('')
    const [transferInput, setTransferInput] = useState('')
    // shift_finalized flag is NOT touched here — it's derived purely from persisted
    // shift_closing data below (all Cuối kỳ counted + cash + transfer both entered),
    // and only synced to localStorage for HistoryPage to classify subsequent expenses
    // as "Sau ca".
    const [isSavingShift, setIsSavingShift] = useState(false)
    const saveShiftClosing = useCallback(async (payload, { existingId } = {}) => {
        if (isSavingShift) return null
        setIsSavingShift(true)
        try {
            const saved = existingId
                ? await updateShiftClosing(existingId, payload)
                : await insertShiftClosing(payload)

            invalidateDailyContext(selectedAddress?.id)
            return saved
        } finally {
            setIsSavingShift(false)
        }
    }, [selectedAddress?.id, isSavingShift])

    // Onboarding phase 3 "Báo cáo dòng tiền" + phase 4 "Báo cáo tồn kho" progress — xem
    // onboarding/steps.js. Cờ chỉ set true (không revert) nên không tái xuất
    // hiện khi dữ liệu hôm sau reset. cash/transfer set trong handleSaveCashflow (đòi hỏi bấm
    // "Lưu"); coffee set ngay khi gõ (không cần lưu) — xem khối render-time-adjust bên dưới.
    const [initialOnboardingState] = useState(() =>
        isGuest && selectedAddress?.id ? readOnboardingState(selectedAddress.id) : DEFAULT_ONBOARDING_STATE
    )
    const [cashFlowProgress, setCashFlowProgress] = useState(initialOnboardingState.cashFlowProgress)
    // inventoryProgress do tab Kiểm kê của /inventory ghi — ở đây chỉ đọc để biết lúc nào hint mũi tên "tiến".
    const { inventoryProgress } = initialOnboardingState
    useOnboardingProgressPersist('cashFlowProgress', cashFlowProgress, { isGuest, addressId: selectedAddress?.id })

    // Báo cáo chỉ còn nhập thực thu (tiền mặt + chuyển khoản) nên không mở kênh realtime kiểm kê —
    // realtime thuộc tab Kiểm kê của /inventory. Catalog NVL chỉ để biết ca đã đếm đủ chưa (cờ "Sau ca").
    const isDayScope = scope === 'day'
    const { ingredientsList } = useIngredientCatalog(selectedAddress?.id, selectedAddress?.ingredient_sort_order, ingredientConfigs)

    // Expense categories — feed dynamic rows into FinanceCards. Refetched per
    // address; new tags added in /history are picked up on next mount or after
    // reportCache invalidation.
    const [expenseCategories, setExpenseCategories] = useState([])
    // Dep là .id chứ không phải cả object: AddressContext seed selectedAddress từ localStorage
    // rồi THAY bằng object mới khi fetch addresses xong (cold start) — nghe cả object thì mỗi
    // lần thay là một round-trip thừa dù địa chỉ không hề đổi.
    const selectedAddressId = selectedAddress?.id
    useEffect(() => {
        if (selectedAddressId === undefined) return
        fetchExpenseCategories(selectedAddressId).then(setExpenseCategories)
    }, [selectedAddressId])

    useEffect(() => {
        if (!isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Pre-fill cash/transfer inputs from the existing shift_closing (if any).
    // Guard with closed_at === today VN: fetchDailyReportContext occasionally
    // returns yesterday's shift_closing as `shift_closing` (server tz / RPC
    // boundary issue), which would leave yesterday's cash + transfer values
    // sticky after midnight. If closed_at isn't today, treat as no row → blank.
    const isTodaysClosing = shiftClosing?.closed_at
        && dateStringVN(new Date(shiftClosing.closed_at)) === todayISO
    const persistedCash = isTodaysClosing && shiftClosing.actual_cash != null
        ? Number(shiftClosing.actual_cash) : 0
    const persistedTransfer = isTodaysClosing && shiftClosing.actual_transfer != null
        ? Number(shiftClosing.actual_transfer) : 0
    // Ô nào đang lệch bản đã lưu — một chỗ tính cho cả nút "Lưu thực thu" (cashDirty),
    // confirm rời trang, và payload lúc ghi. hasExistingRow = true ở đây chỉ để lấy phép so
    // từng ô: nhánh INSERT luôn trả payload đầy đủ nên không suy ra dirty được.
    const cashChanges = useMemo(() => buildCashPayload(
        { actual_cash: persistedCash, actual_transfer: persistedTransfer, cash_closed_at: shiftClosing?.cash_closed_at },
        { actual_cash: parseVNDInput(cashInput) || 0, actual_transfer: parseVNDInput(transferInput) || 0 },
        true,
    ), [persistedCash, persistedTransfer, shiftClosing?.cash_closed_at, cashInput, transferInput])
    const cashDirty = !!cashChanges
    // Prefill: 0 → để TRỐNG chứ không điền "0". Điền lại "0" làm ô Chuyển khoản mất viền
    // đứt + ăn màu chữ "đã nhập", trông như đã đếm xong. 0 và trống tính tiền y hệt nhau
    // nên để trống là an toàn.
    // Chỉ seed khi ĐỔI PHIẾU (load lần đầu / sang ngày mới / đổi scope) — cố ý KHÔNG nghe
    // actual_cash/actual_transfer: lưu xong 2 cột đó đổi, effect này mà chạy sẽ xoá trắng số đang gõ dở.
    useEffect(() => {
        if (!isTodayScope) return
        setCashInput(isTodaysClosing && shiftClosing.actual_cash ? formatVNDInput(shiftClosing.actual_cash) : '')
        setTransferInput(isTodaysClosing && shiftClosing.actual_transfer ? formatVNDInput(shiftClosing.actual_transfer) : '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTodayScope, isTodaysClosing, todayISO, shiftClosing?.id, shiftClosing?.closed_at])

    // Hint spotlight cho phase 3 — xem CashFlowCard. Phase 4 (Kiểm kê) nằm ở /inventory.
    const showOnboardingHints = isGuest && !!selectedAddress?.id
    // Bước 3: chưa kéo tới thì sáng cả thẻ Thực thu; thẻ hiện trọn rồi (CashFlowCard tự đo, gọi
    // markCashCardSeen) thì chỉ sáng ô còn thiếu.
    const cashCardReached = reachedCashCard(cashFlowProgress)
    const hintCashCard = showOnboardingHints && !cashCardReached
    const hintCash = showOnboardingHints && cashCardReached && !cashFlowProgress.cash
    const hintTransfer = showOnboardingHints && cashCardReached && !cashFlowProgress.transfer
    const markCashCardSeen = useCallback(() => setCashFlowProgress(prev => ({ ...prev, scrolled: true })), [])
    const cashFlowDone = isCashFlowProgressDone(cashFlowProgress)
    const inventoryDone = isInventoryProgressDone(inventoryProgress)
    // Xong dòng tiền → mũi tên "tiến" dẫn sang Tồn kho (tab Kiểm kê) để đếm tồn.
    const hintGoToInventory = showOnboardingHints && cashFlowDone && !inventoryDone

    // Phase 5 "Điều chỉnh công thức" không còn nút riêng trong guide — hint thẳng vào mũi tên
    // "tiến" ở header, đi xuyên page tới /category qua menuSequence.js (xem onboarding/steps.js).
    // recipeProgress do RecipeIngredientPage.jsx ghi — đọc lại từ initialOnboardingState (đã
    // đọc localStorage 1 lần ở trên cho cashFlowProgress/inventoryProgress rồi, khỏi đọc thêm).
    const hintGoToRecipes = showOnboardingHints && isRecipeStepActive(inventoryDone, initialOnboardingState.recipeProgress)

    // Week/month scopes show the per-day/per-week bar chart instead of the hourly line.
    // "Range" = khoảng NHIỀU NGÀY. Biểu đồ đường cộng dồn theo GIỜ chỉ có nghĩa cho 1
    // ngày (dòng tiền trong ngày); week/month/custom-nhiều-ngày phải dùng biểu đồ cột.
    // Trước đây bỏ sót custom range nhiều ngày → vẫn hiện line chart sai.
    const isRangeScope = scope === 'week' || scope === 'month'
        || (scope === 'custom' && !isSameDayVN(rangeStart, rangeEnd))

    const [printPreview, setPrintPreview] = useState(false)

    // Chi phí đang mở modal sửa (bấm 1 dòng trong panel Thực chi) — null = đóng.
    const [editingExpense, setEditingExpense] = useState(null)

    // Phiếu nhập kho (Mua nguyên liệu/bao bì) đang mở modal sửa — bấm 1 dòng đi chợ
    // trong panel Thực chi. { entry, addressId, ingredient } | null = đóng. Entry được
    // fetch lại đầy đủ (không dùng payment gộp của CashFlowCard) vì cần amount/discount/
    // extra_cost/payments gốc của cả hoá đơn, không chỉ phần trả trong kỳ báo cáo đang xem.
    const [editingRestock, setEditingRestock] = useState(null)
    // Token chống race: bấm nhanh 2 dòng khác nhau trước khi fetch trước xong → chỉ áp
    // kết quả của lượt bấm MỚI NHẤT, không để lượt cũ resolve trễ ghi đè modal đang mở.
    const restockFetchTokenRef = useRef(0)
    const handleEditRestockPayment = async (payment) => {
        const ingredient = payment?.invoice_metadata?.ingredient
        const expenseId = payment?.expense_id
        if (!ingredient || !expenseId) return
        const addressId = payment.address_id || selectedAddress?.id
        const token = ++restockFetchTokenRef.current
        try {
            const history = await fetchIngredientRestockHistory([addressId], ingredient, new Date(0).toISOString(), new Date().toISOString())
            if (restockFetchTokenRef.current !== token) return
            const entry = history.find(h => h.id === expenseId)
            if (entry) setEditingRestock({ entry, addressId, ingredient })
            else showError(Object.assign(new Error('Không tìm thấy phiếu nhập kho'), { expected: true }), 'Mở phiếu nhập kho')
        } catch (err) { showError(err, 'Tải phiếu nhập kho') }
    }
    const handleSaveRestockEdit = async (form) => {
        const { entry, addressId } = editingRestock
        // Đóng modal ngay (optimistic, khớp pattern IngredientDetailPage.handleEditRestock) —
        // lỗi mạng vẫn báo qua toast, không cần giữ modal mở để user retry.
        setEditingRestock(null)
        try {
            await editIngredientRestock(addressId, entry.id, {
                qty: Number(form.qty),
                subtotal: Number(form.subtotal),
                discount: Number(form.discount),
                extraCost: Number(form.extraCost),
                paid: Number(form.paid),
                paymentMethod: form.paymentMethod,
                cashPhase: form.cashPhase,
                purchaseDate: form.purchaseDate,
                staffName: profile?.name,
            })
            await Promise.all([
                refetchReport(),
                refreshProducts?.(), refreshTodayExpenses?.(),
            ])
            showToast('Đã lưu phiếu nhập kho', 'success')
        } catch (err) { showError(err, 'Sửa phiếu nhập kho') }
    }

    // Sau khi sửa/xoá: scope hôm nay do POSContext tự patch todayExpenses; scope quá
    // khứ đọc từ RPC báo cáo nên phải patch tay (updates = null ⇒ đã xoá).
    const patchReportExpense = (id, updates) => {
        if (isTodayScope) return
        setApiExpenses(prev => updates
            ? prev.map(e => e.id === id ? { ...e, ...updates } : e)
            : prev.filter(e => e.id !== id))
    }

    // Computed display data
    const displayOrders = isTodayScope ? todayOrders : apiOrders
    const displayExpenses = isTodayScope ? todayExpenses : apiExpenses
    // Payments của ngày scope hiện tại — driver chính của cashflow refill (paid_at-based).
    const displayPayments = isTodayScope ? (todayPayments || []) : (apiPayments || [])

    const rangeLabel = useMemo(() => {
        if (scope === 'day') {
            return dateFullVN(rangeStart)
        }
        if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
            const sStr = customRange.startISO.split('-')
            const eStr = customRange.endISO.split('-')
            return `${sStr[2]}/${sStr[1]} – ${eStr[2]}/${eStr[1]}`
        }
        return `${dateShortVN(rangeStart)} – ${dateShortVN(rangeEnd)}`
    }, [scope, rangeStart, rangeEnd, customRange])

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => buildExtraMaps(productExtras), [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalDiscount, totalCOGS, productStats, soldProducts, lineChartData, offlineToday } = useMemo(() => {
        const pending = isTodayScope ? getPendingOrders() : []
        const offlineToday = pending.filter(o => isSameDayVN(new Date(o.createdAt), new Date()))

        const agg = aggregateOrderStats({
            orders: [...displayOrders, ...offlineToday],
            productMap,
            extraPriceMap: extraMaps.priceMap,
            extraNameMap: extraMaps.nameMap,
            recipes, extraIngredients, ingredientCosts,
        })

        return {
            totalRevenue: agg.totalRevenue,
            totalDiscount: agg.totalDiscount,
            totalCOGS: agg.totalCOGS,
            productStats: agg.productStats,
            soldProducts: agg.soldProducts,
            lineChartData: buildHourlyLineChart(agg),
            offlineToday,
        }
    }, [displayOrders, productMap, extraMaps, recipes, extraIngredients, ingredientCosts, isTodayScope])

    // aggregateOrderStats ở trên đã đếm qty từng món trên ĐÚNG tập order này — cộng
    // lại từ productStats thay vì quét orders × items lần thứ hai (2 vòng lặp chuẩn hoá
    // field khác nhau là chỗ dễ lệch). Món count_as_cup=false không tính là ly.
    const totalCups = useMemo(
        () => Object.entries(productStats).reduce(
            (n, [pid, st]) => productMap.get(pid)?.count_as_cup === false ? n : n + st.qty, 0),
        [productStats, productMap],
    )

    const { dailyExpense, refillFreeForm } = useMemo(
        () => splitExpenses(displayExpenses),
        [displayExpenses]
    )
    // Chi phí gắn nhãn nhóm "Ngoài kinh doanh" — KHÔNG vào lợi nhuận (tiền ra ngoài
    // hoạt động KD). Phải trừ khỏi P&L. Bỏ qua đúng theo luật của buildCategoryBreakdown:
    // NVL refill (is_refill & !free_form) + adjustment; free-form refill (sau ca) VẪN xét
    // để khớp 2 nơi nếu phiếu sau ca được gắn nhãn ngoài KD.
    const nonOperatingExpense = useMemo(() => {
        const nonOpIds = new Set(
            (expenseCategories || []).filter(c => c.group_section === 'non_operating').map(c => c.id)
        )
        if (nonOpIds.size === 0) return 0
        let sum = 0
        for (const e of displayExpenses || []) {
            if ((e.is_refill && !e.metadata?.free_form) || e.metadata?.adjustment) continue
            if (e.category_id && nonOpIds.has(e.category_id)) sum += e.amount || 0
        }
        return sum
    }, [displayExpenses, expenseCategories])
    // Vận hành tổng = trong ca + free-form sau ca (sau ca vẫn là vận hành, không phải NVL).
    // Thực chi: legacy is_fixed=true rows ĐÃ được splitExpenses cộng vào dailyExpense.
    // Trừ chi phí ngoài KD khỏi P&L; chi phí tồn kho thì GIỮ (là chi phí thật, ngoài COGS).
    const operationalExpense = dailyExpense + refillFreeForm - nonOperatingExpense

    // ── COGS category breakdown + hao hụt ────────────────────────────────────
    // Map ingredient → category (null when migration 20260523 not deployed yet —
    // splitCogsByCategory treats null as 'main' so the page still renders).
    const categoryByIngredient = useMemo(() => {
        const map = new Map()
        for (const c of ingredientConfigs || []) map.set(c.ingredient, c.category || null)
        return map
    }, [ingredientConfigs])

    const cogsByCategory = useMemo(
        () => splitCogsByCategory(
            [...displayOrders, ...offlineToday],
            recipes, extraIngredients, ingredientCosts, categoryByIngredient
        ),
        [displayOrders, offlineToday, recipes, extraIngredients, ingredientCosts, categoryByIngredient]
    )

    // Đầu kỳ ước tính (hôm nay) — CÙNG số với thẻ Kiểm kê (useWarehouseStockSync) để "Hao hụt / hủy" ở đây khớp với
    // hao hụt từng dòng ở đó. Chỉ phụ thuộc địa chỉ + công thức (không phụ thuộc phiếu hôm nay nên không gọi lại RPC
    // mỗi lần lưu). Ngày khác / chưa có số → {} = như trước.
    const counterCalc = useCounterCalc()
    const [estimatedOpening, setEstimatedOpening] = useState({})
    const recipesReady = recipesBelongTo(recipes, selectedAddress?.id)
    useEffect(() => {
        const addressId = selectedAddress?.id
        if (!isDayScope || !isTodayScope || !isAsyncReady || !addressId) { setEstimatedOpening({}); return }
        let cancelled = false
        fetchIngredientStocks(addressId)
            .then(rows => estimateOpeningStocks(rows, addressId, counterCalc.current))
            .then(estimates => { if (!cancelled) setEstimatedOpening(estimates) })
            .catch(err => console.error('estimatedOpening', err))
        return () => { cancelled = true }
    }, [isDayScope, isTodayScope, isAsyncReady, selectedAddress?.id, counterCalc, recipesReady])

    const lossInfo = useMemo(() => {
        // Daily scope: today's single closing + yesterday as the opening source.
        // Range scope: all closings in the period + prev-period closings.
        // (isDayScope = scope === 'day', khai báo ở trên cùng file — dùng chung với inventorySeed.)
        // Hôm nay: chỉ dùng shiftClosing khi closed_at ĐÚNG là hôm nay — qua nửa đêm server
        // có thể còn trả phiếu hôm qua (ranh giới TZ/RPC); không chặn thì "Hao hụt / hủy" giữ
        // số cũ của hôm qua. Ngày quá khứ (offset<0): dùng phiếu đã fetch của ngày đó.
        const usableClosing = !isDayScope ? null
            : (shiftClosing && (!isTodayScope || isTodaysClosing)) ? shiftClosing : null
        const closings = isDayScope
            ? (usableClosing ? [usableClosing] : [])
            : (apiShiftClosings || [])
        if (closings.length === 0) return { lossValue: 0, nonRecipeUsageLines: [] }

        // Bucket orders by VN date string so calculateLossValue can look up
        // per-day consumption (same dayStr key the RangeLossCard uses).
        const itemsByDay = {}
        const pushItem = (dayStr, productId, qty, extras) => {
            if (!itemsByDay[dayStr]) itemsByDay[dayStr] = []
            itemsByDay[dayStr].push({ productId, qty, extras })
        }
        const sourceOrders = isDayScope ? [...displayOrders, ...offlineToday] : (apiOrders || [])
        for (const o of sourceOrders) {
            if (!isLiveOrder(o)) continue
            const dayStr = dateStringVN(new Date(o.created_at || o.createdAt))
            const items = o.order_items || o.cart || o.orderItems || []
            for (const i of items) {
                pushItem(
                    dayStr,
                    i.product_id || i.productId,
                    i.quantity || i.qty || 1,
                    i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
                )
            }
        }
        const dailyConsumption = {}
        for (const [dayStr, items] of Object.entries(itemsByDay)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients)
        }

        const prevClosings = isDayScope
            ? (yesterdayClosing ? [yesterdayClosing] : [])
            : (prevShiftClosings || [])
        // Làm tròn về VND nguyên (hao hụt = qty lẻ × giá vốn nên hay ra .5) → row + tổng
        // giá vốn + lợi nhuận đều dùng số nguyên nhất quán, không còn hiển thị "...,5đ".
        const { loss, consumption } = calculateLossValue({
            shiftClosings: closings,
            prevShiftClosings: prevClosings,
            openingOverrideMap: isDayScope && isTodayScope && Object.keys(estimatedOpening).length ? openingSeed(yesterdayClosing, estimatedOpening) : null,
            dailyConsumption,
            ingredientConfigs,
            recipeIngredients: buildRecipeIngredientSet(recipes, extraIngredients),
        })
        // Bao bì/vật tư không công thức: tiêu hao của chúng tách riêng, ghi đúng tên
        // (Ống hút, Bịch chữ T...) trong COGS thay vì gộp vào "Hao hụt / hủy".
        const nonRecipeUsageLines = Object.entries(consumption)
            .map(([ingredient, value]) => ({ ingredient, label: ingredientLabel(ingredient), value: Math.round(value) }))
            .filter(l => l.value > 0)
            .sort((a, b) => b.value - a.value)
        return { lossValue: Math.round(loss), nonRecipeUsageLines }
    }, [isDayScope, isTodayScope, isTodaysClosing, shiftClosing, yesterdayClosing, apiShiftClosings, prevShiftClosings, apiOrders, displayOrders, offlineToday, recipes, extraIngredients, ingredientConfigs, estimatedOpening])

    const { lossValue, nonRecipeUsageLines } = lossInfo
    const nonRecipeUsageTotal = nonRecipeUsageLines.reduce((s, l) => s + l.value, 0)

    // P&L = Revenue - COGS - Hao hụt - Tiêu hao bao bì không-công-thức - chi phí thực chi.
    // NVL refill không trừ ở đây (đã nằm trong COGS/tiêu hao qua kiểm kê).
    const netProfit = totalRevenue - totalCOGS - lossValue - nonRecipeUsageTotal - operationalExpense

    // Sync cash flow calculations for both daily view and range view (handling unclosed shifts by falling back to expected order totals)
    const calculateSyncedCashFlow = (isDay, singleClosing, rangeClosings, rangeOrders, rangeOffline = []) => {
        if (isDay) {
            if (singleClosing) {
                return {
                    cash: singleClosing.actual_cash || 0,
                    transfer: singleClosing.actual_transfer || 0
                }
            }
            const orders = [...rangeOrders, ...rangeOffline].filter(isLiveOrder)
            const cash = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
            const transfer = orders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
            return { cash, transfer }
        }

        const closingMap = new Map()
            ; (rangeClosings || []).forEach(s => {
                const dateStr = dateStringVN(new Date(s.closed_at || s.created_at))
                if (!closingMap.has(dateStr)) {
                    closingMap.set(dateStr, { cash: 0, transfer: 0 })
                }
                const val = closingMap.get(dateStr)
                val.cash += s.actual_cash || 0
                val.transfer += s.actual_transfer || 0
            })

        const ordersByDate = new Map()
        const allOrders = [...rangeOrders, ...rangeOffline].filter(isLiveOrder)
        allOrders.forEach(o => {
            const dateStr = dateStringVN(new Date(o.created_at || o.createdAt))
            if (!ordersByDate.has(dateStr)) {
                ordersByDate.set(dateStr, [])
            }
            ordersByDate.get(dateStr).push(o)
        })

        const allDates = new Set([...closingMap.keys(), ...ordersByDate.keys()])

        let totalCash = 0
        let totalTransfer = 0

        allDates.forEach(dateStr => {
            if (closingMap.has(dateStr)) {
                const closing = closingMap.get(dateStr)
                totalCash += closing.cash
                totalTransfer += closing.transfer
            } else {
                const orders = ordersByDate.get(dateStr) || []
                const cash = orders.filter(o => o.payment_method === 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
                const transfer = orders.filter(o => o.payment_method !== 'cash').reduce((sum, o) => sum + (o.total || 0), 0)
                totalCash += cash
                totalTransfer += transfer
            }
        })

        return { cash: totalCash, transfer: totalTransfer }
    }

    // calculateSyncedCashFlow returns { cash, transfer } — alias on destructure to keep
    // the rest of the page calling them actualCash/actualTransfer.
    const { cash: actualCash, transfer: actualTransfer } = useMemo(() => {
        return calculateSyncedCashFlow(scope === 'day', shiftClosing, apiShiftClosings, displayOrders, offlineToday)
    }, [scope, shiftClosing, apiShiftClosings, displayOrders, offlineToday])

    // Chốt ca đầy đủ = cash + counted → ghi cờ "Sau ca" cho HistoryPage (xem useShiftFinalized). Tab
    // Kiểm kê ở /inventory cũng chạy hook này: đếm xong trước/sau thực thu đều ghi đúng lúc.
    useShiftFinalized({
        shiftClosing, isTodaysClosing, ingredientsList,
        isTodayScope, addressId: selectedAddress?.id, todayISO,
    })

    // Sync cờ chốt ca tiền → localStorage để HistoryPage nhận diện đã chốt két.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress) return
        const key = cashClosedKey(selectedAddress.id, todayISO)
        const isCashClosed = isTodaysClosing && shiftClosing?.cash_closed_at != null
        if (isCashClosed) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, Date.now().toString())
        } else {
            localStorage.removeItem(key)
        }
    }, [isTodaysClosing, shiftClosing?.cash_closed_at, isTodayScope, selectedAddress, todayISO])


    // Sum today's orders (online + offline) for the system_total_revenue snapshot we send
    // when creating a new shift_closing. Mirrors /shift-closing's calculation.
    const systemTotalRevenue = useMemo(() => {
        if (!isTodayScope) return 0
        let sum = 0
        for (const o of todayOrders) if (isLiveOrder(o)) sum += o.total || 0
        for (const o of offlineToday) if (isLiveOrder(o)) sum += o.total || 0
        return sum
    }, [isTodayScope, todayOrders, offlineToday])

    // Có thay đổi chưa lưu ở ô Thực thu → cảnh báo trước khi rời, chống mất số đang gõ dở.
    const hasUnsaved = isTodayScope && cashDirty
    useEffect(() => {
        if (!hasUnsaved) return
        const handler = (e) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [hasUnsaved])
    // Bọc các thao tác rời trang (back / đổi ngày) — xác nhận nếu còn thay đổi chưa lưu.
    // Liệt kê cụ thể field nào sắp mất để confirm rõ nghĩa, không mơ hồ.
    const guardLeave = async (proceed) => {
        if (hasUnsaved) {
            const lines = []
            if (cashChanges?.actual_cash !== undefined)
                lines.push(`Thực thu · Tiền mặt: ${formatVNDInput(persistedCash)} → ${formatVNDInput(cashChanges.actual_cash)}`)
            if (cashChanges?.actual_transfer !== undefined)
                lines.push(`Thực thu · Chuyển khoản: ${formatVNDInput(persistedTransfer)} → ${formatVNDInput(cashChanges.actual_transfer)}`)
            const detail = `${lines.map(l => `• ${l}`).join('\n')}\n\nRời trang và bỏ các thay đổi?`
            if (!await confirm({ title: 'Còn thay đổi chưa lưu trong báo cáo.', detail, danger: true, confirmLabel: 'Rời trang' })) return
        }
        proceed()
    }

    // isSavingShift (cờ của hook) chỉ true trong lúc GHI, nhả ngay khi save() xong — nhưng
    // cashDirty phụ thuộc shiftClosing chỉ cập nhật SAU refetch. Cờ riêng này phủ cả refetch
    // → lượt lưu kế tiếp tính payload trên shiftClosing mới, không INSERT/gửi trùng.
    const [savingCashflow, setSavingCashflow] = useState(false)

    // Tự lưu khi rời ô Tiền mặt/Chuyển khoản. Blur trúng lúc đang ghi (ô kia vừa blur, hoặc
    // kiểm kê đang lưu — save() của hook bỏ qua lượt chồng) → đánh dấu chờ, effect bên dưới
    // chạy lại bằng closure mới (input + shiftClosing mới nhất) khi cả 2 cờ nhả.
    const cashSavePendingRef = useRef(false)
    useEffect(() => {
        if (savingCashflow || isSavingShift || !cashSavePendingRef.current) return
        cashSavePendingRef.current = false
        handleSaveCashflow()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savingCashflow, isSavingShift])

    const handleSaveCashflow = async () => {
        if (!selectedAddress) return
        if (savingCashflow || isSavingShift) { cashSavePendingRef.current = true; return }
        // CHỈ ô đã sửa (xem buildCashPayload): máy kia đang đếm ô còn lại thì số của họ không
        // bị bản cũ trong state máy này đè lên. Đường UPDATE dùng lại đúng cashChanges đã
        // tính cho nút Lưu; chỉ phiếu MỚI mới phải dựng payload đầy đủ.
        const cashPayload = shiftClosing?.id ? cashChanges : buildCashPayload(
            null,
            { actual_cash: parseVNDInput(cashInput) || 0, actual_transfer: parseVNDInput(transferInput) || 0 },
            false,
        )
        if (!cashPayload) return   // không ô nào đổi → không gửi request nào
        setSavingCashflow(true)
        const payload = {
            address_id: selectedAddress.id,
            closed_by: profile?.id || null,
            system_total_revenue: systemTotalRevenue,
            ...cashPayload,
        }
        try {
            const saved = await saveShiftClosing(payload, {
                // isTodaysClosing, KHÔNG phải chỉ có id: get_daily_report_context thỉnh
                // thoảng trả phiếu HÔM QUA (biên tz — xem chỗ tính persistedCash). Lúc đó ô
                // Thực thu hiện trống (đúng), nhưng ghi theo id này là UPDATE tiền hôm nay
                // đè lên phiếu hôm qua: hôm qua sai số, hôm nay vẫn trống. Bỏ id ⇒ đi đường
                // INSERT, và insertShiftClosing đã tự lành khi đụng unique index cùng ngày.
                existingId: isTodaysClosing ? shiftClosing?.id : undefined,
            })
            // save() trả null khi bị bỏ qua do đang lưu việc khác → không báo thành công giả,
            // xếp chờ lưu lại khi rảnh.
            if (!saved) { cashSavePendingRef.current = true; return }
            showToast('Đã lưu thực thu', 'success')
            // Onboarding phase 3: cash/transfer done độc lập theo ô có gõ gì hay không lúc bấm
            // lưu — "trigger không theo thứ tự" (không đọc actual_cash/actual_transfer trong
            // payload: trống quy về 0 nên không phân biệt được "chưa nhập" vs "nhập 0").
            if (isGuest) {
                setCashFlowProgress(prev => ({
                    cash: prev.cash || cashInput.trim() !== '',
                    transfer: prev.transfer || transferInput.trim() !== '',
                }))
            }
            // Refetch shift_closing so display + pre-fill sync. invalidateDailyContext
            // inside the hook already cleared the cache, so the network is hit fresh.
            // Fallback về `saved` (row vừa ghi, có id) để giữ id phòng refetch trễ/null →
            // tránh INSERT phiếu trùng ở lần lưu kế.
            const fresh = await fetchDailyReportContext(selectedAddress.id)
            setShiftClosing(fresh?.shift_closing || saved)
        } catch (err) {
            showError(err, 'Lưu thực thu')
        } finally {
            setSavingCashflow(false)
        }
    }

    // Gate: 1 gói all-access mở CẢ 3 view báo cáo. View nào trong nhóm báo cáo
    // (Dòng tiền / Lợi nhuận / Tồn kho) mà address chưa có sub active → early-return
    // NGUYÊN trang đăng ký gói (chrome riêng, back về /pos). Cùng UI với /subscription.
    const needsAccess = view === VIEW_CASHFLOW || view === VIEW_PROFIT || view === VIEW_ALL
    if (monetizationEnabled && !entitlementLoading && needsAccess && !hasAccess) {
        return (
            <Navigate
                to="/subscription"
                replace
                state={{
                    preselectAddressId: selectedAddress?.id,
                    from: '/pos',
                }}
            />
        )
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <HistoryHeader
                title="Báo cáo"
                rangeLabel={rangeLabel}
                scope={scope}
                onBack={() => guardLeave(() => goToMenuStep('report', -1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard }))}
                onForward={() => goToMenuStep('report', +1, { navigate, backTo, scopeState: dateNavState, wizard: location.state?.wizard })}
                hintForward={hintGoToInventory || hintGoToRecipes}
                canGoForward={canGoForwardPeriod}
                onOffsetPrev={() => guardLeave(goOffsetPrev)}
                onOffsetNext={() => guardLeave(goOffsetNext)}
                rangeStartISO={rangeStart ? dateStringVN(rangeStart) : undefined}
                rangeEndISO={rangeEnd ? dateStringVN(rangeEnd) : undefined}
                dayInputValue={dayInputValue}
                todayISO={todayISO}
                canGoForwardDay={canGoForwardDay}
                onPrevDay={() => guardLeave(goPrevDay)}
                onNextDay={() => guardLeave(goNextDay)}
                customRange={customRange}
                onRangeChange={(r) => guardLeave(() => applyRange(r))}
                onShiftRange={(d) => guardLeave(() => shiftRange(d))}
                canShiftRangeForward={canShiftRangeForward}
                onPresetSelect={(p) => guardLeave(() => applyPreset(p))}
                belowTabs={<ReportViewFilter value={view} onChange={setView} isStaff={isStaff} />}
            />

            <main ref={mainRef} className="flex-1 overflow-y-auto px-4 py-6 pb-6 space-y-4 bg-bg">
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
                        {(view === VIEW_ALL || view === VIEW_PROFIT) && !isStaff && (
                            <FinanceCards
                                totalRevenue={totalRevenue}
                                totalDiscount={totalDiscount}
                                totalCOGS={totalCOGS}
                                netProfit={netProfit}
                                expenses={displayExpenses}
                                expenseCategories={expenseCategories}
                                cogsByCategory={cogsByCategory}
                                lossValue={lossValue}
                                nonRecipeUsageLines={nonRecipeUsageLines}
                                onRecipesClick={() => guardLeave(() => navigate('/category/recipes', { state: { from: '/report/cashflow' } }))}
                            />
                        )}

                        {/* onEditExpense: bấm 1 dòng chi phí → mở modal sửa ngay tại chỗ,
                            không rời tab Báo cáo (xem ExpenseEditorModal ở cuối trang). */}
                        {(view === VIEW_ALL || view === VIEW_CASHFLOW) && (
                            <CashFlowCard
                                actualCash={actualCash}
                                actualTransfer={actualTransfer}
                                dailyExpense={dailyExpense}
                                refillFreeForm={refillFreeForm}
                                expenses={displayExpenses}
                                payments={displayPayments}
                                expenseCategories={expenseCategories}
                                editable={isTodayScope}
                                cashInput={cashInput}
                                transferInput={transferInput}
                                onCashChange={(v) => setCashInput(formatVNDInput(v))}
                                onTransferChange={(v) => setTransferInput(formatVNDInput(v))}
                                onInputBlur={handleSaveCashflow}
                                hintCard={hintCashCard}
                                onCardFullyVisible={hintCashCard ? markCashCardSeen : undefined}
                                hintCash={hintCash}
                                hintTransfer={hintTransfer}
                                onEditExpense={setEditingExpense}
                                onEditRestockPayment={handleEditRestockPayment}
                                printInfo={{ addressName: selectedAddress?.name, dateLabel: rangeLabel, revenue: totalRevenue, cups: totalCups, printerIp: selectedAddress?.counter_printer_ip }}
                                printPreview={printPreview}
                                onPreviewClose={() => setPrintPreview(false)}
                                onPrintError={e => showError(e, 'In báo cáo')}
                            >
                                <div className="flex flex-col gap-4">
                                    <SalesCard
                                        totalCups={totalCups}
                                        products={products}
                                        soldProducts={soldProducts}
                                        totalRevenue={totalRevenue}
                                        productStats={productStats}
                                        lineChartData={lineChartData}
                                        showChart={!isRangeScope}
                                    />
                                    {isRangeScope && (
                                        <DayPerformanceChart
                                            orders={displayOrders}
                                            range={scope}
                                            start={rangeStart}
                                            products={products}
                                        />
                                    )}
                                </div>
                            </CashFlowCard>
                        )}

                        <div className="flex items-center justify-center gap-2 p-3">
                            <button onClick={() => setShowSupportModal(true)} className={FOOT_BTN}>Hỗ trợ / góp ý</button>
                            {/* In báo cáo dòng tiền cuối ca — tờ in dựng trong CashFlowCard nên
                                chỉ có khi tab đang hiện Dòng tiền. */}
                            {(view === VIEW_ALL || view === VIEW_CASHFLOW) && (
                                <button onClick={() => setPrintPreview(true)} className={FOOT_BTN}>In báo cáo</button>
                            )}
                        </div>
                    </div>
                )}
            </main>

            <Toast toast={toast} />

            {editingExpense && (
                <ExpenseEditorModal
                    expense={editingExpense}
                    addressId={selectedAddress?.id}
                    onSaved={patchReportExpense}
                    onClose={() => setEditingExpense(null)}
                />
            )}

            {/* Sửa phiếu nhập kho (bấm 1 dòng "Mua nguyên liệu/bao bì" trong panel Thực chi) —
                tái dùng RestockModal của /inventory, xem handleEditRestockPayment. */}
            {editingRestock && (() => {
                const { entry, ingredient } = editingRestock
                const cfg = (ingredientsList || []).find(i => i.ingredient === ingredient)
                return (
                    <RestockModal
                        ingredient={ingredient}
                        unit={getIngredientUnit(ingredient, ingredientUnits[ingredient])}
                        packSize={cfg?.pack_size}
                        packUnit={cfg?.pack_unit}
                        cashClosedToday={false}
                        mode="edit"
                        initial={{
                            qty: entry.metadata?.qty ?? 0,
                            subtotal: entry.metadata?.subtotal ?? entry.amount ?? 0,
                            discount: entry.discount_amount ?? 0,
                            extraCost: entry.extra_cost ?? 0,
                            paid: (entry.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
                            paymentMethod: entry.payment_method || 'cash',
                            cashPhase: entry.metadata?.cash_phase || 'post_close',
                            purchaseDate: dateStringVN(new Date(entry.created_at)),
                            purchaseTime: timeStringVN(new Date(entry.created_at)),
                        }}
                        onConfirm={handleSaveRestockEdit}
                        onClose={() => setEditingRestock(null)}
                    />
                )
            })()}

            {/* Support Modal */}
            <SupportModal
                open={showSupportModal}
                onClose={() => setShowSupportModal(false)}
            />
        </div>
    )
}
