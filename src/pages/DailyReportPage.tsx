import { useState, useEffect, useMemo, useRef } from 'react'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { formatVNDInput, parseVNDInput } from '../utils'
import { aggregateOrderStats, buildExtraMaps, splitExpenses } from '../utils/reportStats'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchDailyReportContext, fetchIngredientStocks, invalidateDailyContext, editIngredientRestock, fetchIngredientRestockHistory, insertShiftClosing, updateShiftClosing } from '../services/orderService'
import { buildCashPayload } from '../services/reportService'
import { useIngredientCatalog } from '../hooks/useIngredientCatalog'
import { useDailyReportData } from '../hooks/useDailyReportData'
import { calculateEstimatedConsumption, splitCogsByCategory, calculateLossValue, buildRecipeIngredientSet, isLiveOrder, openingSeed, pack2Of, orderItemsOf, sumLiveRevenue } from '../utils/inventory'
import { estimateOpening, recipesBelongTo } from '../services/counterEstimate'
import { useCounterCalc } from '../hooks/useCounterCalc'
import { calcRangeWithLabel } from '../utils/rangeCalc'
import { restockInitialFrom } from '../utils/restockInitial'
import { ingredientLabel, getIngredientUnit } from '../utils/ingredients'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, isCashFlowProgressDone, isInventoryProgressDone } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { isRecipeStepActive } from '../components/common/onboarding/steps'
import { dateStringVN, isSameDayVN } from '../utils/dateVN'
import { overlayProduction } from '../utils/production'
import { useDateScope } from '../hooks/useDateScope'
import { goToMenuStep } from '../utils/menuSequence'
import { useTabRoute } from '../hooks/useTabRoute'
import HistoryHeader from '../components/HistoryPage/HistoryHeader'
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
import RestockModal, { type RestockPayload } from '../components/IngredientManagementPage/RestockModal'
import type { ExpenseCategory, Row, UUID } from '../types/domain'

// Pill cuối trang (Hỗ trợ / góp ý · In báo cáo).
const FOOT_BTN = 'px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 cursor-pointer text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap text-primary'

// Tiền mặt / chuyển khoản dự kiến từ đơn khi chưa có phiếu chốt ca: payment_method khác 'cash' tính là chuyển khoản.
const splitByMethod = (orders: Row[]) => {
    let cash = 0, transfer = 0
    for (const o of orders) {
        if (o.payment_method === 'cash') cash += o.total || 0
        else transfer += o.total || 0
    }
    return { cash, transfer }
}

// Thực thu cho cả view ngày lẫn khoảng: ngày nào có phiếu chốt thì lấy số đã nhập, chưa chốt thì rơi về tổng đơn của ngày đó.
function calculateSyncedCashFlow(isDay: boolean, singleClosing: Row | null | undefined, rangeClosings: Row[] | null | undefined, rangeOrders: Row[], rangeOffline: Row[] = []) {
    const orders = [...rangeOrders, ...rangeOffline].filter(isLiveOrder)
    if (isDay) {
        return singleClosing
            ? { cash: singleClosing.actual_cash || 0, transfer: singleClosing.actual_transfer || 0 }
            : splitByMethod(orders)
    }

    const closingByDay = new Map<string, { cash: number; transfer: number }>()
    for (const s of rangeClosings || []) {
        const day = dateStringVN(new Date(s.closed_at || s.created_at))
        const val = closingByDay.get(day) ?? { cash: 0, transfer: 0 }
        val.cash += s.actual_cash || 0
        val.transfer += s.actual_transfer || 0
        closingByDay.set(day, val)
    }
    const ordersByDay = new Map<string, Row[]>()
    for (const o of orders) {
        const day = dateStringVN(new Date(o.created_at || o.createdAt))
        const bucket = ordersByDay.get(day)
        if (bucket) bucket.push(o)
        else ordersByDay.set(day, [o])
    }

    let cash = 0, transfer = 0
    for (const day of new Set([...closingByDay.keys(), ...ordersByDay.keys()])) {
        const v = closingByDay.get(day) ?? splitByMethod(ordersByDay.get(day) || [])
        cash += v.cash
        transfer += v.transfer
    }
    return { cash, transfer }
}

export default function DailyReportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/history/sales'
    const { products, recipes, ingredientCosts, extraIngredients, productExtras, ingredientUnits, ingredientConfigs, productionRows, refreshProducts } = useProducts()
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
    const mainRef = useRef<HTMLElement>(null)
    useEffect(() => { mainRef.current?.scrollTo(0, 0) }, [view])
    const [showSupportModal, setShowSupportModal] = useState(false)
    const { addressId, selectedAddress } = useAddress()
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
        addressId,
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

    // Onboarding phase 3 "Báo cáo dòng tiền" + phase 4 "Báo cáo tồn kho" progress — xem
    // onboarding/steps.ts. Cờ chỉ set true (không revert) nên không tái xuất
    // hiện khi dữ liệu hôm sau reset. cash/transfer set trong handleSaveCashflow (đòi hỏi bấm
    // "Lưu"); coffee set ngay khi gõ (không cần lưu) — xem khối render-time-adjust bên dưới.
    const [initialOnboardingState] = useState(() =>
        isGuest && addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE
    )
    const [cashFlowProgress, setCashFlowProgress] = useState(initialOnboardingState.cashFlowProgress)
    // inventoryProgress do tab Kiểm kê của /inventory ghi — ở đây chỉ đọc để biết lúc nào hint mũi tên "tiến".
    const { inventoryProgress } = initialOnboardingState
    useOnboardingProgressPersist('cashFlowProgress', cashFlowProgress, { isGuest, addressId })
    // Việc "Xem báo cáo lợi nhuận" của phase 3 (sau khi nhập thực thu): tick khi user tự bấm sang tab Lợi nhuận.
    const [journalProgress, setJournalProgress] = useState(initialOnboardingState.journalProgress)
    useOnboardingProgressPersist('journalProgress', journalProgress, { isGuest, addressId })
    const { viewedProfit } = journalProgress
    useEffect(() => {
        if (!isGuest || !addressId || view !== VIEW_PROFIT || viewedProfit || !isCashFlowProgressDone(cashFlowProgress)) return
        setJournalProgress(prev => ({ ...prev, viewedProfit: true }))
    }, [isGuest, addressId, view, viewedProfit, cashFlowProgress])

    // Báo cáo chỉ còn nhập thực thu (tiền mặt + chuyển khoản) nên không mở kênh realtime kiểm kê —
    // realtime thuộc tab Kiểm kê của /inventory. Catalog NVL chỉ để biết ca đã đếm đủ chưa (cờ "Sau ca").
    const isDayScope = scope === 'day'
    const { ingredientsList } = useIngredientCatalog(addressId, selectedAddress?.ingredient_sort_order, ingredientConfigs)

    // Expense categories — feed dynamic rows into FinanceCards. Refetched per
    // address; new tags added in /history are picked up on next mount or after
    // reportCache invalidation.
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
    // Dep là .id chứ không phải cả object: AddressContext seed selectedAddress từ localStorage
    // rồi THAY bằng object mới khi fetch addresses xong (cold start) — nghe cả object thì mỗi
    // lần thay là một round-trip thừa dù địa chỉ không hề đổi.
    useEffect(() => {
        fetchExpenseCategories(addressId).then(setExpenseCategories)
    }, [addressId])

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
    // Chỉ CHỦ quán (manager_id của địa chỉ) sửa được Thực thu ngày quá khứ (chỉ khi đã có phiếu);
    // đồng quản lý và nhân viên chỉ sửa hôm nay.
    const isOwner = isGuest || (!!profile?.id && selectedAddress?.manager_id === profile.id)
    // Phiếu phải đúng ngày đang xem (lúc đổi ngày shiftClosing còn là phiếu ngày trước → blur ghi nhầm);
    // hôm nay lấy từ todayISO vì rangeStart không tự nhích qua nửa đêm.
    const cashClosing = !!shiftClosing?.id && dateStringVN(new Date(shiftClosing.closed_at)) === (isTodayScope ? todayISO : dateStringVN(rangeStart))
    const cashEditable = isTodayScope || (scope === 'day' && isOwner && cashClosing)
    const persistedCash = cashClosing && shiftClosing?.actual_cash != null
        ? Number(shiftClosing.actual_cash) : 0
    const persistedTransfer = cashClosing && shiftClosing?.actual_transfer != null
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
        if (!cashEditable) return
        setCashInput(cashClosing && shiftClosing?.actual_cash ? formatVNDInput(shiftClosing.actual_cash) : '')
        setTransferInput(cashClosing && shiftClosing?.actual_transfer ? formatVNDInput(shiftClosing.actual_transfer) : '')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cashEditable, cashClosing, todayISO, shiftClosing?.id, shiftClosing?.closed_at])

    // Hint spotlight cho phase 3 — xem CashFlowCard. Phase 4 (Kiểm kê) nằm ở /inventory.
    const showOnboardingHints = isGuest && !!addressId
    // Bước 3: sáng ô còn thiếu; CashFlowCard tự cuộn thẻ Thực thu vào màn hình (không có việc "Kéo xuống").
    const hintCash = showOnboardingHints && !cashFlowProgress.cash
    const hintTransfer = showOnboardingHints && !cashFlowProgress.transfer
    const cashFlowDone = isCashFlowProgressDone(cashFlowProgress)
    const inventoryDone = isInventoryProgressDone(inventoryProgress)
    // Xong dòng tiền + đã xem Lợi nhuận → mũi tên "tiến" dẫn sang Tồn kho (tab Kiểm kê) để đếm tồn.
    // Chờ viewedProfit để không sáng cùng lúc với tab Lợi nhuận.
    const hintGoToInventory = showOnboardingHints && cashFlowDone && viewedProfit && !inventoryDone

    // Phase 5 "Điều chỉnh công thức" không còn nút riêng trong guide — hint thẳng vào mũi tên
    // "tiến" ở header, đi xuyên page tới /category qua menuSequence.ts (xem onboarding/steps.ts).
    // recipeProgress do RecipeIngredientPage.tsx ghi — đọc lại từ initialOnboardingState (đã
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
    const [editingExpense, setEditingExpense] = useState<Row | null>(null)

    // Phiếu nhập kho (Mua nguyên liệu/bao bì) đang mở modal sửa — bấm 1 dòng đi chợ
    // trong panel Thực chi. { entry, addressId, ingredient } | null = đóng. Entry được
    // fetch lại đầy đủ (không dùng payment gộp của CashFlowCard) vì cần amount/discount/
    // extra_cost/payments gốc của cả hoá đơn, không chỉ phần trả trong kỳ báo cáo đang xem.
    const [editingRestock, setEditingRestock] = useState<{ entry: Row; addressId: UUID; ingredient: string } | null>(null)
    // Token chống race: bấm nhanh 2 dòng khác nhau trước khi fetch trước xong → chỉ áp
    // kết quả của lượt bấm MỚI NHẤT, không để lượt cũ resolve trễ ghi đè modal đang mở.
    const restockFetchTokenRef = useRef(0)
    const handleEditRestockPayment = async (payment: Row) => {
        const ingredient = payment?.invoice_metadata?.ingredient
        const expenseId = payment?.expense_id
        const targetId: UUID | null = payment?.address_id || addressId
        if (!ingredient || !expenseId || !targetId) return
        const token = ++restockFetchTokenRef.current
        try {
            const history = await fetchIngredientRestockHistory([targetId], ingredient, new Date(0).toISOString(), new Date().toISOString())
            if (restockFetchTokenRef.current !== token) return
            const entry = (history as Row[]).find(h => h.id === expenseId)
            if (entry) setEditingRestock({ entry, addressId: targetId, ingredient })
            else showError(Object.assign(new Error('Không tìm thấy phiếu nhập kho'), { expected: true }), 'Mở phiếu nhập kho')
        } catch (err) { showError(err, 'Tải phiếu nhập kho') }
    }
    const handleSaveRestockEdit = async (form: RestockPayload) => {
        if (!editingRestock) return
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
                staffName: profile?.name ?? null,
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
    const patchReportExpense = (id: UUID, updates: Row | null) => {
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

    const rangeLabel = useMemo(() => calcRangeWithLabel(scope, offset, customRange).label, [scope, offset, customRange])

    const isReady = !isLoadingHistory && isAsyncReady

    // O(1) product lookup — rebuilt only when products list changes
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

    // Extra maps — rebuilt only when productExtras changes
    const extraMaps = useMemo(() => buildExtraMaps(productExtras), [productExtras])

    // All heavy stats: only reruns when orders/recipes/products change, NOT on UI state changes
    const { totalRevenue, totalDiscount, totalCOGS, productStats, offlineToday } = useMemo(() => {
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
        const map = new Map<string, string | null>()
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
    const [estimatedOpening, setEstimatedOpening] = useState<Record<string, number>>({})
    const recipesReady = recipesBelongTo(recipes, addressId)
    useEffect(() => {
        if (!isDayScope || !isTodayScope || !isAsyncReady || !addressId) { setEstimatedOpening(prev => Object.keys(prev).length ? {} : prev); return }
        let cancelled = false
        fetchIngredientStocks(addressId)
            .then(rows => estimateOpening(rows, addressId, counterCalc.current))
            .then(({ stocks }) => { if (!cancelled) setEstimatedOpening(stocks) })
            .catch(err => console.error('estimatedOpening', err))
        return () => { cancelled = true }
    }, [isDayScope, isTodayScope, isAsyncReady, addressId, counterCalc, recipesReady])

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
        const itemsByDay: Record<string, ReturnType<typeof orderItemsOf>> = {}
        const sourceOrders: Row[] = isDayScope ? [...displayOrders, ...offlineToday] : (apiOrders || [])
        for (const o of sourceOrders) {
            if (!isLiveOrder(o)) continue
            const dayStr = dateStringVN(new Date(o.created_at || o.createdAt))
            ;(itemsByDay[dayStr] ||= []).push(...orderItemsOf(o))
        }
        let dailyConsumption: Record<string, ReturnType<typeof calculateEstimatedConsumption>> = {}
        for (const [dayStr, items] of Object.entries(itemsByDay)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients)
        }
        dailyConsumption = overlayProduction(dailyConsumption, productionRows, true) // mẻ sản xuất: nguyên liệu gốc dùng thật, không phải hao hụt

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
    }, [isDayScope, isTodayScope, isTodaysClosing, shiftClosing, yesterdayClosing, apiShiftClosings, prevShiftClosings, apiOrders, displayOrders, offlineToday, recipes, extraIngredients, ingredientConfigs, estimatedOpening, productionRows])

    const { lossValue, nonRecipeUsageLines } = lossInfo
    const nonRecipeUsageTotal = nonRecipeUsageLines.reduce((s, l) => s + l.value, 0)

    // P&L = Revenue - COGS - Hao hụt - Tiêu hao bao bì không-công-thức - chi phí thực chi.
    // NVL refill không trừ ở đây (đã nằm trong COGS/tiêu hao qua kiểm kê).
    const netProfit = totalRevenue - totalCOGS - lossValue - nonRecipeUsageTotal - operationalExpense

    // calculateSyncedCashFlow returns { cash, transfer } — alias on destructure to keep
    // the rest of the page calling them actualCash/actualTransfer.
    const { cash: actualCash, transfer: actualTransfer } = useMemo(() => {
        return calculateSyncedCashFlow(scope === 'day', shiftClosing, apiShiftClosings, displayOrders, offlineToday)
    }, [scope, shiftClosing, apiShiftClosings, displayOrders, offlineToday])

    // Chốt ca đầy đủ = cash + counted → ghi cờ "Sau ca" cho HistoryPage (xem useShiftFinalized). Tab
    // Kiểm kê ở /inventory cũng chạy hook này: đếm xong trước/sau thực thu đều ghi đúng lúc.
    useShiftFinalized({
        shiftClosing, isTodaysClosing, ingredientsList,
        isTodayScope, addressId, todayISO,
    })

    // Sync cờ chốt ca tiền → localStorage để HistoryPage nhận diện đã chốt két.
    useEffect(() => {
        if (!isTodayScope || !selectedAddress) return
        const key = cashClosedKey(addressId, todayISO)
        const isCashClosed = isTodaysClosing && shiftClosing?.cash_closed_at != null
        if (isCashClosed) {
            if (!localStorage.getItem(key)) localStorage.setItem(key, Date.now().toString())
        } else {
            localStorage.removeItem(key)
        }
    }, [isTodaysClosing, shiftClosing?.cash_closed_at, isTodayScope, selectedAddress, addressId, todayISO])


    // Sum today's orders (online + offline) for the system_total_revenue snapshot we send
    // when creating a new shift_closing. Mirrors /shift-closing's calculation.
    const systemTotalRevenue = useMemo(
        () => (isTodayScope ? sumLiveRevenue(todayOrders, offlineToday) : 0),
        [isTodayScope, todayOrders, offlineToday]
    )

    // Có thay đổi chưa lưu ở ô Thực thu → cảnh báo trước khi rời, chống mất số đang gõ dở.
    const hasUnsaved = cashEditable && cashDirty
    useEffect(() => {
        if (!hasUnsaved) return
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [hasUnsaved])
    // Bọc các thao tác rời trang (back / đổi ngày) — xác nhận nếu còn thay đổi chưa lưu.
    // Liệt kê cụ thể field nào sắp mất để confirm rõ nghĩa, không mơ hồ.
    const guardLeave = async (proceed: () => void) => {
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
        if (savingCashflow || !cashSavePendingRef.current) return
        cashSavePendingRef.current = false
        handleSaveCashflow()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savingCashflow])

    const handleSaveCashflow = async () => {
        if (!selectedAddress) return
        if (savingCashflow) { cashSavePendingRef.current = true; return }
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
            address_id: addressId,
            closed_by: profile?.id || null,
            // Phiếu quá khứ đã có snapshot doanh thu — đừng ghi đè bằng 0.
            ...(isTodayScope && { system_total_revenue: systemTotalRevenue }),
            ...cashPayload,
        }
        try {
            // isTodaysClosing, KHÔNG phải chỉ có id: get_daily_report_context thỉnh
            // thoảng trả phiếu HÔM QUA (biên tz — xem chỗ tính persistedCash). Lúc đó ô
            // Thực thu hiện trống (đúng), nhưng ghi theo id này là UPDATE tiền hôm nay
            // đè lên phiếu hôm qua: hôm qua sai số, hôm nay vẫn trống. Bỏ id ⇒ đi đường
            // INSERT, và insertShiftClosing đã tự lành khi đụng unique index cùng ngày.
            const existingId = cashClosing ? shiftClosing?.id : undefined
            const saved = existingId
                ? await updateShiftClosing(existingId, payload)
                : await insertShiftClosing(payload)
            invalidateDailyContext(addressId)
            showToast('Đã lưu thực thu', 'success')
            // Onboarding phase 3: cash/transfer done độc lập theo ô có gõ gì hay không lúc bấm
            // lưu — "trigger không theo thứ tự" (không đọc actual_cash/actual_transfer trong
            // payload: trống quy về 0 nên không phân biệt được "chưa nhập" vs "nhập 0").
            if (isGuest) {
                setCashFlowProgress(prev => ({
                    ...prev,
                    cash: prev.cash || cashInput.trim() !== '',
                    transfer: prev.transfer || transferInput.trim() !== '',
                }))
            }
            // Refetch shift_closing so display + pre-fill sync. invalidateDailyContext
            // inside the hook already cleared the cache, so the network is hit fresh.
            // Fallback về `saved` (row vừa ghi, có id) để giữ id phòng refetch trễ/null →
            // tránh INSERT phiếu trùng ở lần lưu kế.
            if (isTodayScope) {
                const fresh = await fetchDailyReportContext(addressId)
                setShiftClosing(fresh?.shift_closing || saved)
            } else {
                await refetchReport()
            }
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
                    preselectAddressId: addressId,
                    from: '/pos',
                }}
            />
        )
    }

    const restockCfg = editingRestock && (ingredientsList || []).find(i => i.ingredient === editingRestock.ingredient)

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
                belowTabs={<ReportViewFilter value={view} onChange={setView} isStaff={isStaff} hintProfit={showOnboardingHints && cashFlowDone && !viewedProfit} />}
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
                            />
                        )}

                        {/* onEditExpense: bấm 1 dòng chi phí → mở modal sửa ngay tại chỗ,
                            không rời tab Báo cáo (xem ExpenseEditorModal ở cuối trang). */}
                        {(view === VIEW_ALL || view === VIEW_CASHFLOW) && (
                            <CashFlowCard
                                actualCash={actualCash}
                                actualTransfer={actualTransfer}
                                dailyExpense={dailyExpense}
                                revenue={totalRevenue}
                                refillFreeForm={refillFreeForm}
                                expenses={displayExpenses}
                                payments={displayPayments}
                                expenseCategories={expenseCategories}
                                editable={cashEditable}
                                cashInput={cashInput}
                                transferInput={transferInput}
                                onCashChange={(v) => setCashInput(formatVNDInput(v))}
                                onTransferChange={(v) => setTransferInput(formatVNDInput(v))}
                                onInputBlur={handleSaveCashflow}
                                hintCash={hintCash}
                                hintTransfer={hintTransfer}
                                onEditExpense={setEditingExpense}
                                onEditRestockPayment={handleEditRestockPayment}
                                printInfo={{ addressName: selectedAddress?.name, dateLabel: rangeLabel, revenue: totalRevenue, cups: totalCups, printerIp: selectedAddress?.counter_printer_ip }}
                                printPreview={printPreview}
                                onPreviewClose={() => setPrintPreview(false)}
                                onPrintError={e => showError(e, 'In báo cáo')}
                            >
                                {isRangeScope && (
                                    <DayPerformanceChart
                                        orders={displayOrders}
                                        range={scope}
                                        start={rangeStart}
                                        products={products}
                                    />
                                )}
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
                    addressId={addressId}
                    onSaved={patchReportExpense}
                    onClose={() => setEditingExpense(null)}
                />
            )}

            {/* Sửa phiếu nhập kho (bấm 1 dòng "Mua nguyên liệu/bao bì" trong panel Thực chi) —
                tái dùng RestockModal của /inventory, xem handleEditRestockPayment. */}
            {editingRestock && (
                <RestockModal
                    ingredient={editingRestock.ingredient}
                    unit={getIngredientUnit(editingRestock.ingredient, ingredientUnits[editingRestock.ingredient])}
                    packSize={restockCfg?.pack_size}
                    packUnit={restockCfg?.pack_unit}
                    pack2={pack2Of(restockCfg)}
                    cashClosedToday={false}
                    mode="edit"
                    initial={restockInitialFrom(editingRestock.entry)}
                    onConfirm={handleSaveRestockEdit}
                    onClose={() => setEditingRestock(null)}
                />
            )}

            {/* Support Modal */}
            <SupportModal
                open={showSupportModal}
                onClose={() => setShowSupportModal(false)}
            />
        </div>
    )
}
