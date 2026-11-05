import { useState, useEffect, useMemo, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useHistory } from '../../contexts/HistoryContext'
import { useProducts } from '../../contexts/ProductContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { fetchDailyReportContext, invalidateDailyContext, updateShiftClosing } from '../../services/orderService'
import { useShiftInventoryState } from '../../hooks/useShiftInventoryState'
import { useDailyReportData } from '../../hooks/useDailyReportData'
import { useShiftFinalized } from '../../hooks/useShiftFinalized'
import { useMissingCupSuspicion } from '../../hooks/useMissingCupSuspicion'
import type { useDateScope } from '../../hooks/useDateScope'
import type { useToast } from '../../hooks/useToast'
import type { OnboardingState } from '../../utils/onboardingStorage'
import type { Row } from '../../types/domain'
import { useOnboardingProgress } from '../../hooks/useOnboardingProgress'
import { useVisualViewportBox } from '../../hooks/useVisualViewportBox'
import { getPendingOrders } from '../../hooks/useOfflineSync'
import { calculateEstimatedConsumption, calculateConsumptionBreakdown, buildIngredientToProduct, orderItemsOf, isLiveOrder, sumLiveRevenue } from '../../utils/inventory'
import { ingredientLabel } from '../../utils/ingredients'
import { findIngredientByLabel, onboardingHintClass } from '../../utils/onboardingHint'
import { isInventoryProgressDone } from '../../utils/onboardingStorage'
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
    const { todayOrders, isLoadingHistory, handleLoadHistory } = useHistory()
    const confirm = useConfirm()

    const { scope, offset, customRange } = dateScope

    const {
        todayISO, isTodayScope,
        shiftClosing, setShiftClosing, yesterdayClosing,
        apiOrders, apiShiftClosings, prevShiftClosings, isAsyncReady,
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
    const inventory = useShiftInventoryState(addressId, selectedAddress?.ingredient_sort_order, todayISO, onFieldConflict, undefined, inventorySeed)

    const isTodaysClosing = !!shiftClosing?.closed_at && dateStringVN(new Date(shiftClosing.closed_at)) === todayISO
    const shiftDone = useShiftFinalized({
        shiftClosing, isTodaysClosing, ingredientsList: inventory.ingredientsList,
        isTodayScope, addressId, todayISO,
    })

    // Lần lưu kiểm kê cuối = counted_at (server đóng khi số đếm đổi) lớn nhất trong phiếu hôm nay.
    // ponytail: lưu chỉ sửa Nhập thêm/Đầu kỳ không đóng dấu mới → không dời mốc; null → hiện nhãn cũ.
    const lastSavedAt = useMemo(() => {
        const times = ((shiftClosing?.inventory_report as { counted_at?: string }[] | undefined) ?? [])
            .map(e => e.counted_at ? new Date(e.counted_at).getTime() : NaN)
            .filter(t => !Number.isNaN(t))
        return times.length ? new Date(Math.max(...times)) : null
    }, [shiftClosing])

    // ── Hao hụt hôm nay: lượng tiêu hao ước tính từ đơn hôm nay (online + chờ đồng bộ) ──
    const offlineToday = useMemo(
        () => (isTodayScope ? getPendingOrders().filter(o => isSameDayVN(new Date(o.createdAt), new Date())) : []),
        [isTodayScope]
    )
    const todayOrderItems = useMemo(
        () => (isTodayScope ? [...todayOrders.filter(isLiveOrder), ...offlineToday].flatMap(o => orderItemsOf(o)) : []),
        [isTodayScope, todayOrders, offlineToday]
    )
    // Hôm nay: tiêu hao từ đơn + ròng của mẻ sản xuất (nguyên liệu gốc +, thành phẩm −).
    const usedMap = useMemo(
        () => (isTodayScope ? mergeUsage(calculateEstimatedConsumption(todayOrderItems, recipes, extraIngredients), productionOnDay(productionRows, todayISO)) : calculateEstimatedConsumption(todayOrderItems, recipes, extraIngredients)),
        [todayOrderItems, recipes, extraIngredients, isTodayScope, productionRows, todayISO]
    )
    // Phần thành phẩm làm ra hôm nay (dương) — cộng vào "Nhập thêm" khi hiển thị để Sử dụng chỉ còn phần bán.
    const madeMap = useMemo(
        () => isTodayScope ? madeOf(productionOnDay(productionRows, todayISO)) : {},
        [isTodayScope, productionRows, todayISO]
    )
    const periodMadeMap = useMemo(() => madeInPeriods(productionRows, inventory.openingPeriods, todayISO), [productionRows, inventory.openingPeriods, todayISO])
    const consumptionBreakdown = useMemo(
        () => calculateConsumptionBreakdown(todayOrderItems, recipes, extraIngredients, products, productExtras),
        [todayOrderItems, recipes, extraIngredients, products, productExtras]
    )
    const ingredientToProduct = useMemo(
        () => buildIngredientToProduct({ orderItems: todayOrderItems, recipes, products }),
        [recipes, products, todayOrderItems],
    )
    const missingCupCandidates = useMissingCupSuspicion({
        enabled: isTodayScope && !isStaff,
        addressId,
        ingredientsList: inventory.ingredientsList,
        inventoryInputs: inventory.inventoryInputs,
        restockInputs: inventory.restockInputs,
        openingInputs: inventory.openingInputs,
        openingStock: inventory.openingStock,
        usedMap, recipes, extraIngredients, products,
    })
    const inventoryRowUnits = useMemo(
        () => Object.fromEntries(inventory.ingredientsList.map(i => [i.ingredient, i.unit])),
        [inventory.ingredientsList]
    )
    // Snapshot doanh thu hệ thống gửi kèm khi tạo phiếu chốt mới.
    const systemTotalRevenue = useMemo(
        () => (isTodayScope ? sumLiveRevenue(todayOrders, offlineToday) : 0),
        [isTodayScope, todayOrders, offlineToday]
    )

    // ── Onboarding phase 4 (Kiểm kê tồn kho): hint Cà phê → Cacao, tick khi bấm Lưu ──
    // Bắt đầu sau Nhật ký (viewedReport = đã bấm mũi tên "tiến" từ /history).
    const { viewedReport } = useOnboardingProgress('journalProgress', { isGuest, addressId })
    const hintInventory = isGuest && !!addressId && viewedReport && !isInventoryProgressDone(inventoryProgress)
    // 3 câu hỏi lần lượt (mỗi lúc sáng 1 chỗ trên dòng cà phê): đã dùng bao nhiêu (Sử dụng) → máy tính
    // còn bao nhiêu (Lý thuyết) → mình đếm được bao nhiêu (Cuối kỳ).
    const hintStep: HintStep = !inventoryProgress.usedOpened ? 'used' : !inventoryProgress.theoryOpened ? 'theory' : 'count'
    const onHintSeen = useCallback(
        (step: 'used' | 'theory') => setInventoryProgress(prev => ({ ...prev, [step === 'used' ? 'usedOpened' : 'theoryOpened']: true })),
        [setInventoryProgress]
    )
    const onHintValue = useCallback(
        (theory: number) => setInventoryProgress(prev => (prev.theory === theory ? prev : { ...prev, theory })),
        [setInventoryProgress]
    )
    // NVL của bước onboarding: chỉ cà phê (đếm ly/nắp là cùng một thao tác).
    const coffee = isGuest ? findIngredientByLabel(inventory.ingredientsList, 'cà phê')?.ingredient : undefined
    const coffeeTyped = !!coffee && (inventory.inventoryInputs[coffee] ?? '') !== ''
    // Gõ xong mà chưa bấm Lưu → dải guide đổi sang nhắc bấm Lưu, nút Lưu nhấp nháy.
    const inventoryTyped = hintInventory && coffeeTyped
    useEffect(() => {
        if (inventoryTyped !== !!inventoryProgress.typed) setInventoryProgress(prev => ({ ...prev, typed: inventoryTyped }))
    }, [inventoryTyped, inventoryProgress.typed, setInventoryProgress])
    const hintInventoryIngredient = hintInventory ? coffee ?? null : null

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
            if (coffeeTyped) setInventoryProgress(prev => ({ ...prev, coffee: true }))
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

    // Rời ô Cuối kỳ → tự lưu như Tiền mặt/Chuyển khoản (không autosave từng phím). Nhập thêm chưa lưu
    // thì handleSaveInventory tự hỏi xác nhận trước. Ref giữ handler ổn định cho IngredientRow (memo).
    // Tự lưu KHÔNG làm mới bố cục (dựng lại dòng + xếp lại thứ tự theo baseline) — không thì danh sách
    // nhảy ngay dưới ngón tay khi sang ô kế tiếp. Bố cục chỉ làm mới khi bấm nút Lưu (hold = false).
    const holdLayoutRef = useRef(false)
    const layoutRef = useRef({ version: inventory.baselineVersion, snapshot: inventory.baselineSnapshot })
    if (!holdLayoutRef.current) layoutRef.current = { version: inventory.baselineVersion, snapshot: inventory.baselineSnapshot }
    const blurSaveRef = useRef(() => {})
    // Guest giữ nút Lưu: bước onboarding dạy bấm Lưu.
    blurSaveRef.current = () => { if (!isGuest && inventory.isDirty && !isSaving) { holdLayoutRef.current = true; handleSaveInventory() } }
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

    // Bàn phím ảo không đẩy `position: fixed` lên → nhấc nút Lưu lên đúng phần bị che.
    const vvBox = useVisualViewportBox()
    const kbInset = vvBox ? Math.max(0, window.innerHeight - vvBox.height - vvBox.top) : 0

    // Hôm nay: chờ cả tồn kho/quầy (stocksLoaded) — không thì thẻ hiện sớm với map rỗng, Tổng hao hụt nháy 0đ rồi mới nhảy số thật.
    const isReady = !isLoadingHistory && isAsyncReady && (!isTodayScope || inventory.stocksLoaded)

    return (
        <div className="flex flex-col gap-3">
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
                        hintStep={hintStep}
                        onHintSeen={onHintSeen}
                        onHintValue={onHintValue}
                    />

                    {!isStaff && <MissingCupSuspicionCard candidates={missingCupCandidates} />}

                    {shiftDone && (
                        <div className="flex items-center justify-center gap-2 bg-success/10 border border-success/30 px-3 py-2 rounded-[10px] text-success">
                            <span className="text-[12px] font-bold uppercase tracking-wide">{lastSavedAt ? `Lần cuối kiểm kê: ${timeStringVN(lastSavedAt)}` : 'Đã hoàn tất ca hôm nay'}</span>
                        </div>
                    )}
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

            {isTodayScope && isGuest && inventory.isDirty && (
                <div
                    className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40"
                    style={kbInset ? { transform: `translateY(-${kbInset}px)` } : undefined}
                >
                    <div className={`flex justify-end px-4 pointer-events-auto ${kbInset ? 'mb-3' : 'mb-[72px]'}`}>
                        <button
                            onClick={() => { holdLayoutRef.current = false; handleSaveInventory() }}
                            disabled={isSaving}
                            className={`bg-primary text-black rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed ${onboardingHintClass(inventoryTyped, 'solid')}`}
                        >
                            {isSaving ? 'Đang lưu...' : 'Lưu'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
