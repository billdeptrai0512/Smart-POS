import { useState, useEffect, useMemo, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useHistory } from '../../contexts/HistoryContext'
import { useProducts } from '../../contexts/ProductContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { fetchDailyReportContext, invalidateDailyContext, updateShiftClosing } from '../../services/orderService'
import { confirmInventory } from '../../services/reportService'
import { useShiftInventoryState } from '../../hooks/useShiftInventoryState'
import { useDailyReportData } from '../../hooks/useDailyReportData'
import { useShiftFinalized } from '../../hooks/useShiftFinalized'
import { useMissingCupSuspicion } from '../../hooks/useMissingCupSuspicion'
import type { useDateScope } from '../../hooks/useDateScope'
import type { useToast } from '../../hooks/useToast'
import type { OnboardingState } from '../../utils/onboardingStorage'
import type { Row } from '../../types/domain'
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress'
import { getPendingOrders } from '../../hooks/useOfflineSync'
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, buildIngredientToProduct, orderItemsOf, isLiveOrder, sumLiveRevenue, usedOf, computeBalance } from '../../utils/inventory'
import { ingredientLabel } from '../../utils/ingredients'
import { findIngredientByLabel } from '../../utils/onboardingHint'
import { inShiftCashTotal } from '../../utils/reportStats'
import { getGuestUnbilled } from '../../services/localRepository'
import { isInventoryProgressDone, isCashFlowProgressDone } from '../../utils/onboardingStorage'
import { dateStringVN, isSameDayVN, timeStringVN } from '../../utils/dateVN'
import { productionOnDay, mergeUsage, madeOf, madeInPeriods } from '../../utils/production'
import TodayProduction from './TodayProduction'
import InventoryReportCard, { type HintStep } from '../DailyReportPage/InventoryReportCard'
import PastInventoryEditor from '../DailyReportPage/PastInventoryEditor'
import RangeLossCard from '../DailyReportPage/RangeLossCard'
import MissingCupSuspicionCard from '../DailyReportPage/MissingCupSuspicionCard'

// Tab "Kiểm kê" của /inventory — chuyển từ tab Kiểm kê của /report sang đây. Hôm nay:
// đếm Cuối kỳ + nhập thêm rồi "Lưu"; ngày cũ: sửa Cuối kỳ của phiếu đã chốt; tuần/tháng/tuỳ
// chọn: tổng hao hụt cả kỳ. Chọn ngày nằm ở header trang cha (dateScope truyền xuống).
//
// onUnsavedChange: trang cha chặn rời trang (mũi tên, đổi tab, đổi ngày) khi còn sửa chưa lưu —
// tab báo lên bằng chuỗi mô tả (null = sạch).
interface Props {
    dateScope: Pick<ReturnType<typeof useDateScope>, 'scope' | 'offset' | 'customRange'>
    inventoryProgress: OnboardingState['inventoryProgress']
    setInventoryProgress: Dispatch<SetStateAction<OnboardingState['inventoryProgress']>>
    onUnsavedChange: (summary: string | null) => void
    showToast: ReturnType<typeof useToast>['showToast']
    showError: ReturnType<typeof useToast>['showError']
}

export default function InventoryAuditTab({ dateScope, inventoryProgress, setInventoryProgress, onUnsavedChange, showToast, showError }: Props) {
    const { addressId, selectedAddress } = useAddress()
    const { isStaff, profile, isGuest } = useAuth()
    const { products, recipes, extraIngredients, productExtras, ingredientUnits, productionRows } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory } = useHistory()
    const confirm = useConfirm()

    const { scope, offset, customRange } = dateScope

    const {
        todayISO, isTodayScope,
        shiftClosing, setShiftClosing, yesterdayClosing,
        apiOrders, apiShiftClosings, prevShiftClosings, isAsyncReady, todayPayments,
    } = useDailyReportData({ addressId, scope, offset, customRange, onError: showError })

    useEffect(() => {
        if (!isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const onFieldConflict = useCallback((ingredient: string) => {
        showToast(`${ingredientLabel(ingredient)}: vừa được cập nhật từ máy khác, kiểm tra lại`, 'warning')
    }, [showToast])

    const isDayScope = scope === 'day'
    const inventorySeed = useMemo(
        () => ({ isDayScope, seedReady: isDayScope && isAsyncReady, todayClosing: shiftClosing, yesterdayClosing }),
        [isDayScope, isAsyncReady, shiftClosing, yesterdayClosing]
    )
    // Máy khác đếm / xác nhận: kéo inventory_report mới về để banner "Đã xác nhận" và mốc cắt đơn theo kịp.
    const onRemoteRow = useCallback((row: Row) => {
        if (row.inventory_report) setShiftClosing(prev => (prev ? { ...prev, inventory_report: row.inventory_report } : prev))
    }, [setShiftClosing])
    const inventory = useShiftInventoryState(addressId, selectedAddress?.ingredient_sort_order, todayISO, onFieldConflict, onRemoteRow, inventorySeed)

    const isTodaysClosing = !!shiftClosing?.closed_at && dateStringVN(new Date(shiftClosing.closed_at)) === todayISO
    useShiftFinalized({   // chỉ để ghi cờ "hoàn tất ca" (HistoryPage đọc), banner đã thay bằng nút Khóa
        shiftClosing, isTodaysClosing, ingredientsList: inventory.ingredientsList,
        isTodayScope, addressId, todayISO,
    })

    // Giờ xác nhận kiểm kê lần cuối = confirmed_at (server đóng bởi set_inventory_confirm, mất khi số đếm đổi) lớn nhất
    // trong phiếu hôm nay; có = số Cuối kỳ đã thành Tồn quầy đang có, đơn sau giờ này trừ tiếp vào đó.
    // changedSince: có entry đã đếm mà chưa xác nhận (sửa số sau lần xác nhận trước). allCounted: mọi NVL đã đếm hoặc bỏ qua.
    const { confirmedAt, confirmedByIng, changedSince, allCounted } = useMemo(() => {
        const report = (shiftClosing?.inventory_report as { ingredient: string; remaining?: number | null; skipped?: boolean; confirmed_at?: string }[] | undefined) ?? []
        const confirmedByIng = new Map(report.filter(e => e.confirmed_at).map(e => [e.ingredient, new Date(e.confirmed_at!).getTime()]))
        const times = [...confirmedByIng.values()]
        const byIng = new Map(report.map(e => [e.ingredient, e]))
        return {
            confirmedByIng,
            confirmedAt: times.length ? new Date(Math.max(...times)) : null,
            changedSince: times.length > 0 && report.some(e => e.remaining != null && !e.confirmed_at),
            allCounted: inventory.ingredientsList.length > 0 && inventory.ingredientsList.every(ing => {
                const e = byIng.get(ing.ingredient)
                return e && (e.remaining != null || e.skipped)
            }),
        }
    }, [shiftClosing, inventory.ingredientsList])

    // ── Hao hụt hôm nay: lượng tiêu hao ước tính từ đơn hôm nay (online + chờ đồng bộ) ──
    const offlineToday = useMemo(
        () => (isTodayScope ? getPendingOrders().filter(o => isSameDayVN(new Date(o.createdAt), new Date())) : []),
        [isTodayScope]
    )
    const ordersToday = useMemo(
        () => (isTodayScope
            ? [...todayOrders.filter(isLiveOrder).map(o => ({ at: new Date(o.created_at).getTime(), items: orderItemsOf(o) })),
                ...offlineToday.map(o => ({ at: new Date(o.createdAt).getTime(), items: orderItemsOf(o) }))]
            : []),
        [isTodayScope, todayOrders, offlineToday]
    )
    // Đã xác nhận kiểm kê: đơn SAU giờ xác nhận thuộc kỳ mới (trừ vào số đã xác nhận), không tính vào hao hụt của kỳ vừa đếm.
    // Chỉ dùng cho bảng "dùng cho món nào" (breakdown); Sử dụng từng NVL cắt theo giờ xác nhận RIÊNG của nó (usedMap).
    const todayOrderItems = useMemo(
        () => ordersToday.filter(o => !confirmedAt || o.at < confirmedAt.getTime()).flatMap(o => o.items),
        [ordersToday, confirmedAt]
    )
    // Hôm nay: tiêu hao từ đơn + ròng của mẻ sản xuất (nguyên liệu gốc +, thành phẩm −).
    // NVL đã xác nhận chỉ tính đơn trước giờ xác nhận CỦA NÓ; NVL đếm lại sau đó (mất confirmed_at) tính đủ đơn tới giờ.
    // Mẻ sản xuất cắt theo giờ xác nhận RIÊNG của NVL y như đơn: mẻ SAU giờ đó không nằm trong số đã đếm
    // (tồn quầy đã trừ/cộng nó qua productionAfterCount) — không cắt thì thành phẩm làm ra sau xác nhận hiện hụt đúng bằng mẻ.
    const productionMap = useMemo(() => {
        if (!isTodayScope) return {}
        const prod = productionOnDay(productionRows, todayISO)
        for (const at of new Set(confirmedByIng.values())) {
            const before = productionOnDay(productionRows.filter(p => new Date(p.created_at).getTime() < at), todayISO)
            for (const [ing, t] of confirmedByIng) if (t === at) prod[ing] = usedOf(before, ing)
        }
        return prod
    }, [isTodayScope, productionRows, todayISO, confirmedByIng])
    const usedMap = useMemo(() => {
        const used = { ...calculateEstimatedConsumption(ordersToday.flatMap(o => o.items), recipes, extraIngredients) }
        for (const at of new Set(confirmedByIng.values())) {
            const before = calculateEstimatedConsumption(ordersToday.filter(o => o.at < at).flatMap(o => o.items), recipes, extraIngredients)
            for (const [ing, t] of confirmedByIng) if (t === at) used[ing] = usedOf(before, ing)
        }
        return isTodayScope ? mergeUsage(used, productionMap) : used
    }, [ordersToday, confirmedByIng, recipes, extraIngredients, isTodayScope, productionMap])
    // Phần thành phẩm làm ra hôm nay (dương) — cộng vào "Nhập thêm" khi hiển thị để Sử dụng chỉ còn phần bán.
    const madeMap = useMemo(() => madeOf(productionMap), [productionMap])
    const periodMadeMap = useMemo(() => madeInPeriods(productionRows, inventory.openingPeriods, todayISO), [productionRows, inventory.openingPeriods, todayISO])
    // Cắt đơn theo giờ xác nhận RIÊNG của từng NVL — cùng mốc với usedMap, để "Đã sử dụng" và danh sách mũi tên không lệch nhau.
    const consumptionBreakdown = useMemo(() => {
        const calc = (items: typeof todayOrderItems) => calculateConsumptionBreakdown(items, recipes, extraIngredients, products, productExtras)
        const breakdown = calc(ordersToday.flatMap(o => o.items))
        for (const at of new Set(confirmedByIng.values())) {
            const before = calc(ordersToday.filter(o => o.at < at).flatMap(o => o.items))
            for (const [ing, t] of confirmedByIng) if (t === at) { if (before[ing]) breakdown[ing] = before[ing]; else delete breakdown[ing] }
        }
        return breakdown
    }, [ordersToday, confirmedByIng, recipes, extraIngredients, products, productExtras])
    const ingredientToProduct = useMemo(
        () => buildIngredientToProduct({ orderItems: todayOrderItems, recipes, products }),
        [recipes, products, todayOrderItems],
    )
    const inventoryRowUnits = useMemo(
        () => Object.fromEntries(inventory.ingredientsList.map(i => [i.ingredient, i.unit])),
        [inventory.ingredientsList]
    )
    // Snapshot doanh thu hệ thống gửi kèm khi tạo phiếu chốt mới.
    const systemTotalRevenue = useMemo(
        () => (isTodayScope ? sumLiveRevenue(todayOrders, offlineToday) : 0),
        [isTodayScope, todayOrders, offlineToday]
    )
    // Chênh lệch két hôm nay — cùng công thức thẻ "So sánh" ở /report (Thực thu = két + chi trong ca, trừ Doanh thu).
    // Thẻ nghi vấn đặt cạnh số ly ước tính: két dư đúng tiền mấy ly đó là bằng chứng thứ 2. null = chưa nhập thực thu.
    const cashDiff = useMemo(() => {
        const cash = Number(shiftClosing?.actual_cash || 0), transfer = Number(shiftClosing?.actual_transfer || 0)
        if (!isTodayScope || !isTodaysClosing || !(cash + transfer)) return null
        const inShift = inShiftCashTotal(todayPayments, todayExpenses)
        return cash + transfer + inShift - systemTotalRevenue
    }, [isTodayScope, isTodaysClosing, shiftClosing, todayPayments, todayExpenses, systemTotalRevenue])
    const missingCupCandidates = useMissingCupSuspicion({
        enabled: isTodayScope && !isStaff,
        addressId,
        ingredientsList: inventory.ingredientsList,
        inventoryInputs: inventory.inventoryInputs,
        restockInputs: inventory.restockInputs,
        openingInputs: inventory.openingInputs,
        openingStock: inventory.openingStock,
        usedMap, recipes, extraIngredients, products, productExtras, cashDiff,
    })

    // ── Guide bước 5 (Kiểm kê): hint dòng cà phê, tick khi bấm Lưu. Bắt đầu sau Kết ca (bước 4, /report). ──
    const cashFlowProgress = useOnboardingProgress('cashFlowProgress', { isGuest, addressId })
    const hintInventory = isGuest && !!addressId && isCashFlowProgressDone(cashFlowProgress) && !isInventoryProgressDone(inventoryProgress)
    // Sáng ô Cuối kỳ của dòng cà phê (chi tiết Sử dụng đã hiện sẵn, không còn việc bấm xem).
    const hintStep: HintStep = 'count'
    // NVL của bước onboarding: chỉ cà phê (đếm ly/nắp là cùng một thao tác).
    const coffee = isGuest ? findIngredientByLabel(inventory.ingredientsList, 'cà phê')?.ingredient : undefined
    const coffeeTyped = !!coffee && (inventory.inventoryInputs[coffee] ?? '') !== ''
    const hintInventoryIngredient = hintInventory ? coffee ?? null : null

    // Demo: khách chỉ tự đếm cà phê; các NVL/bao bì khác điền sẵn "số nhân viên đếm" = Lý thuyết − đúng phần của mấy
    // ly pha không bấm bill (getGuestUnbilled) → Tổng hao hụt + thẻ "Khả năng bấm thiếu" chỉ đúng món/số ly,
    // khớp với số két dư ở Kết ca. Guide gợi ý số cà phê nhập = Lý thuyết − phần cà phê của mấy ly đó. 1 lần mỗi lần mở tab, ô đã có số thì giữ.
    const prefilledRef = useRef(false)
    useEffect(() => {
        if (!hintInventory || !isTodayScope || prefilledRef.current || !inventory.stocksLoaded || !inventory.closingLoaded || !ordersToday.length) return
        prefilledRef.current = true
        const unbilled = getGuestUnbilled()?.usage || {}
        for (const ing of inventory.ingredientsList) {
            const key = ing.ingredient
            const used = usedOf(usedMap, key)
            if (used <= 0) continue
            const o = inventory.openingInputs[key]
            const { lyThuyet } = computeBalance({ restockValue: inventory.restockInputs[key], openingValue: o === '' ? undefined : o, openingFallback: inventory.openingStock[key] ?? 0, used })
            const counted = String(Math.max(0, Math.round(lyThuyet - (unbilled[key] || 0))))
            if (key === coffee) setInventoryProgress(prev => ({ ...prev, suggest: Number(counted) }))
            else if ((inventory.inventoryInputs[key] ?? '') === '') inventory.onInventoryChange(key, counted)
        }
        setTimeout(() => blurSaveRef.current(), 0) // lưu luôn như rời ô — khỏi dải "chưa lưu" khi khách chưa kịp nhập cà phê
    }, [hintInventory, isTodayScope, inventory, ordersToday.length, usedMap, coffee, setInventoryProgress])

    // Cà phê đã có số và đã lưu → tick bước sau ~1,2s (toast "Đã lưu" + số vừa lưu còn trên dòng) → dòng thu lại, cuộn
    // xuống Tổng hao hụt. Effect (không setTimeout trong handleSave): rời trang giữa chừng thì lần sau vào vẫn tick được.
    useEffect(() => {
        if (!hintInventory || !coffeeTyped || inventory.isDirty) return
        const t = setTimeout(() => setInventoryProgress(prev => ({ ...prev, coffee: true })), 1200)
        return () => clearTimeout(t)
    }, [hintInventory, coffeeTyped, inventory.isDirty, setInventoryProgress])

    const [isSaving, setIsSaving] = useState(false)
    const [openAudit, setOpenAudit] = useState(true)

    // Lưu Kiểm kê hôm nay: chỉ đẩy field đã đổi (merge race-free server-side). Tự lưu khi rời ô Cuối kỳ
    // (onFieldBlur bên dưới), không lưu từng phím.
    const handleSaveInventory = async () => {
        if (!selectedAddress) return
        if (inventory.restockDirty
            && !await confirm({ title: inventory.existingClosing?.id ? 'Cập nhật báo cáo (có chuyển kho ra quầy)?' : 'Lưu báo cáo (có chuyển kho ra quầy)?' })) return

        setIsSaving(true)
        try {
            const row = await inventory.pushInventory(profile?.id, systemTotalRevenue)
            if (!row) return // không có gì đổi (hoặc đang có push khác chạy) → isDirty giữ để thử lại
            showToast('Đã lưu kiểm kê tồn cuối ca', 'success')
            const [fresh] = await Promise.all([
                fetchDailyReportContext(addressId),
                inventory.reloadStocks(),
            ])
            setShiftClosing(fresh?.shift_closing || row)
            if (fresh?.shift_closing) inventory.setExistingClosing(fresh.shift_closing)
        } catch (err) {
            showError(err, 'Lưu báo cáo tồn kho')
        } finally {
            setIsSaving(false)
        }
    }

    // Xác nhận kiểm kê lần cuối: số Cuối kỳ thành Tồn quầy đang có, đơn sau giờ này trừ tiếp vào đó (migration 20261041).
    const handleConfirmInventory = async () => {
        if (!selectedAddress) return
        setIsSaving(true)
        try {
            const row = await confirmInventory(addressId)
            const [fresh] = await Promise.all([fetchDailyReportContext(addressId), inventory.reloadStocks()])
            setShiftClosing(fresh?.shift_closing || row)
            if (fresh?.shift_closing) inventory.setExistingClosing(fresh.shift_closing)
            showToast('Đã xác nhận kiểm kê lần cuối', 'success')
        } catch (err) {
            showError(err, 'Xác nhận kiểm kê')
        } finally {
            setIsSaving(false)
        }
    }

    // Rời ô Cuối kỳ → tự lưu như Tiền mặt/Chuyển khoản (không autosave từng phím). Nhập thêm chưa lưu
    // thì handleSaveInventory tự hỏi xác nhận trước. Ref giữ handler ổn định cho IngredientRow (memo).
    // Tự lưu KHÔNG làm mới bố cục (dựng lại dòng + xếp lại thứ tự theo baseline) — không thì danh sách
    // nhảy ngay dưới ngón tay khi sang ô kế tiếp. Bố cục chỉ làm mới khi bấm nút Lưu (hold = false).
    const holdLayoutRef = useRef(false)
    const layoutRef = useRef({ version: inventory.baselineVersion, snapshot: inventory.baselineSnapshot })
    if (!holdLayoutRef.current) layoutRef.current = { version: inventory.baselineVersion, snapshot: inventory.baselineSnapshot }
    const blurSaveRef = useRef(() => {})
    blurSaveRef.current = () => { if (inventory.isDirty && !isSaving) { holdLayoutRef.current = true; handleSaveInventory() } }
    const onFieldBlur = useCallback(() => blurSaveRef.current(), [])

    // Sửa Cuối kỳ của 1 NGÀY QUÁ KHỨ — UPDATE thẳng inventory_report của phiếu ngày đó (không qua
    // merge RPC vì merge khoá cứng phiếu hôm nay). Tồn được tính lúc đọc nên hao hụt/lợi nhuận
    // tự tính lại; không đụng kho tổng (chỉ sửa remaining, không sửa restock).
    const handleSavePastInventory = async (newReport: Row[]) => {
        if (!selectedAddress || !shiftClosing?.id) return false
        if (!await confirm({ title: 'Cập nhật tồn cuối ca của ngày này?', detail: 'Hao hụt và lợi nhuận của ngày sẽ được tính lại.' })) return false
        setIsSaving(true)
        try {
            const saved = await updateShiftClosing(shiftClosing.id, { address_id: addressId, inventory_report: newReport })
            invalidateDailyContext(addressId)
            setShiftClosing(saved || { ...shiftClosing, inventory_report: newReport })
            showToast('Đã cập nhật tồn cuối kỳ', 'success')
            return true
        } catch (err) {
            showError(err, 'Cập nhật tồn cuối ca')
            return false
        } finally {
            setIsSaving(false)
        }
    }

    // ── Chưa lưu: báo cha (chặn rời trang) + cảnh báo đóng tab trình duyệt ──
    const [pastInvDirty, setPastInvDirty] = useState<{ dirty: boolean; lines: string[] }>({ dirty: false, lines: [] })
    const handlePastInvDirty = useCallback((dirty: boolean, lines: string[]) => setPastInvDirty({ dirty, lines }), [])
    const hasUnsaved = isTodayScope ? inventory.isDirty : (isDayScope && pastInvDirty.dirty)
    const unsavedKey = hasUnsaved ? (isTodayScope ? inventory.dirtySummary : pastInvDirty.lines).join('\n') : null
    useEffect(() => {
        onUnsavedChange(unsavedKey)
        return () => onUnsavedChange(null)
    }, [unsavedKey, onUnsavedChange])
    useEffect(() => {
        if (!hasUnsaved) return
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [hasUnsaved])

    // Hôm nay: chờ cả tồn kho/quầy (stocksLoaded) — không thì thẻ hiện sớm với map rỗng, Tổng hao hụt nháy 0đ rồi mới nhảy số thật.
    const isReady = !isLoadingHistory && isAsyncReady && (!isTodayScope || inventory.stocksLoaded)

    return (
        <div className={`flex flex-col gap-3 lg:mx-auto ${isTodayScope ? '' : 'lg:max-w-4xl'}`}>
            {!isReady ? (
                // Hình dạng như nội dung thật (2 thẻ nhóm + thẻ tổng) để lúc hiện ra không nhảy chiều cao.
                <div className="flex flex-col gap-3 animate-pulse">
                    <div className="bg-surface-light rounded-[20px] h-[54px]" />
                    <div className="bg-surface-light rounded-[20px] h-[54px]" />
                    <div className="bg-surface-light rounded-[20px] h-[110px]" />
                </div>
            ) : isTodayScope ? (
                <div className="flex flex-col gap-3 animate-fade-in">
                    {/* setTimeout: calcRef (useCounterCalc) cập nhật mẻ mới ở effect sau render — tải lại tồn quầy phải đợi nó. */}
                    {!isGuest && <TodayProduction onChanged={() => setTimeout(() => inventory.reloadStocks(), 50)} onError={showError} />}
                    <InventoryReportCard
                        ingredientsList={inventory.ingredientsList}
                        isLoading={inventory.isLoadingIngredients}
                        openingStock={inventory.openingStock}
                        openingPeriods={inventory.openingPeriods}
                        openingNotes={inventory.openingNotes}
                        openingInputs={inventory.openingInputs}
                        openingLocked={inventory.openingLocked}
                        restockInputs={inventory.restockInputs}
                        inventoryInputs={inventory.inventoryInputs}
                        warehouseStocks={inventory.effectiveWarehouseStocks}
                        ingredientUnits={inventoryRowUnits}
                        usedMap={usedMap}
                        madeMap={madeMap}
                        periodMadeMap={periodMadeMap}
                        consumptionBreakdown={consumptionBreakdown}
                        ingredientToProduct={ingredientToProduct}
                        isSubmitting={isSaving}
                        baselineInputs={layoutRef.current.snapshot}
                        baselineVersion={layoutRef.current.version}
                        onOpeningChange={inventory.onOpeningChange}
                        onRestockChange={inventory.onRestockChange}
                        onInventoryChange={inventory.onInventoryChange}
                        onFieldBlur={onFieldBlur}
                        open={openAudit}
                        onToggleOpen={() => setOpenAudit(o => !o)}
                        hintIngredient={hintInventoryIngredient}
                        hintFill={inventoryProgress.suggest}
                        // Cà phê đã lưu → tắt nhấp nháy ngay (dòng vẫn mở ~1,2s chờ tick, xem effect tick coffee) — khỏi tưởng chưa xong.
                        hintStep={coffeeTyped && !inventory.isDirty ? null : hintStep}
                        beforeTotal={!isGuest && (
                            <div className={`flex items-center justify-between gap-3 rounded-[14px] border px-3 py-2.5 ${changedSince ? 'bg-warning/10 border-warning/30' : confirmedAt ? 'bg-success/10 border-success/30' : 'bg-surface border-border/40'}`}>
                                <div className="min-w-0">
                                    <p className={`text-[12px] font-bold ${changedSince ? 'text-warning' : confirmedAt ? 'text-success' : 'text-text'}`}>
                                        {changedSince ? `Có số mới sau lần xác nhận ${timeStringVN(confirmedAt!)}` : confirmedAt ? `Đã xác nhận kiểm kê lúc ${timeStringVN(confirmedAt)}` : 'Chưa xác nhận kiểm kê'}
                                    </p>
                                    <p className="text-[11px] text-text-dim">
                                        {inventory.isDirty ? 'Đang có thay đổi chưa lưu' : !allCounted ? 'Đếm hết nguyên liệu để xác nhận' : 'Đơn mới sau giờ xác nhận trừ vào tồn quầy'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    disabled={isSaving || inventory.isDirty || !allCounted || (!!confirmedAt && !changedSince)}   // đã xác nhận mà chưa có số mới: bấm lại sẽ dời mốc trừ đơn, tồn quầy nhảy ngược
                                    onClick={handleConfirmInventory}
                                    className={`shrink-0 rounded-[10px] px-3 py-2 text-[12px] font-bold disabled:opacity-40 ${confirmedAt && !changedSince ? 'border border-success/40 text-success' : 'bg-success text-bg'}`}
                                >
                                    {confirmedAt ? 'Cập nhật' : 'Xác nhận'}
                                </button>
                            </div>
                        )}
                        afterTotal={!isStaff && <MissingCupSuspicionCard candidates={missingCupCandidates} cash={cashDiff == null ? null : { diff: cashDiff, system: systemTotalRevenue }} />}
                    />
                </div>
            ) : isDayScope ? (
                // Ngày cũ: chủ/quản lý + có phiếu chốt (có id để UPDATE) → sửa được Cuối kỳ. Staff
                // hoặc ngày không có phiếu → onSave={null} = editor tự khoá read-only.
                <PastInventoryEditor
                    shiftClosing={shiftClosing}
                    yesterdayClosing={yesterdayClosing}
                    dayOrders={apiOrders}
                    recipes={recipes}
                    extraIngredients={extraIngredients}
                    products={products}
                    productExtras={productExtras}
                    ingredientUnits={ingredientUnits}
                    ingredientsList={inventory.ingredientsList}
                    isLoading={inventory.isLoadingIngredients}
                    isSaving={isSaving}
                    onSave={!isStaff && shiftClosing?.id ? handleSavePastInventory : null}
                    onDirtyChange={handlePastInvDirty}
                />
            ) : (
                <RangeLossCard
                    orders={apiOrders}
                    shiftClosings={apiShiftClosings}
                    prevShiftClosings={prevShiftClosings}
                    recipes={recipes}
                    extraIngredients={extraIngredients}
                    ingredientUnits={ingredientUnits}
                />
            )}

        </div>
    )
}
