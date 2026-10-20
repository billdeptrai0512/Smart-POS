import { useState, useEffect, useMemo, useCallback, type Dispatch, type SetStateAction } from 'react'
import { Loader2 } from 'lucide-react'
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
import { findIngredientByLabel } from '../../utils/onboardingHint'
import { isCashFlowProgressDone, isInventoryProgressDone, INVENTORY_ONBOARDING_ITEMS } from '../../utils/onboardingStorage'
import { dateStringVN, isSameDayVN } from '../../utils/dateVN'
import { productionOnDay, mergeUsage } from '../../utils/production'
import TodayProduction from './TodayProduction'
import InventoryReportCard from '../DailyReportPage/InventoryReportCard'
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
    const cashFlowProgress = useOnboardingProgress('cashFlowProgress', { isGuest, addressId })
    const hintInventory = isGuest && !!addressId
        && isCashFlowProgressDone(cashFlowProgress) && !isInventoryProgressDone(inventoryProgress)
    // Việc "Kiểm kê nguyên liệu cuối ngày": tick khi user đã điều hướng tới tab này (mũi tên từ /report).
    useEffect(() => {
        if (hintInventory && !inventoryProgress.visited) setInventoryProgress(prev => ({ ...prev, visited: true }))
    }, [hintInventory, inventoryProgress.visited, setInventoryProgress])
    // Mỗi NVL của bước onboarding: hint dừng ở NVL đầu tiên chưa tick.
    const onboardingTargets = useMemo(() => (isGuest
        ? INVENTORY_ONBOARDING_ITEMS.map(i => ({ key: i.key, ingredient: findIngredientByLabel(inventory.ingredientsList, i.label)?.ingredient }))
        : []), [isGuest, inventory.ingredientsList])
    const hintInventoryIngredient = hintInventory
        ? onboardingTargets.find(t => !inventoryProgress[t.key])?.ingredient ?? null
        : null

    const [isSaving, setIsSaving] = useState(false)
    const [openAudit, setOpenAudit] = useState(true)

    // Lưu Kiểm kê hôm nay: chỉ đẩy field đã đổi (merge race-free server-side), không autosave từng
    // phím — autosave sẽ ghi Cuối kỳ lên DB và Đầu kỳ bị carry-forward thành đúng số đó.
    const handleSaveInventory = async () => {
        if (!selectedAddress) return
        if (inventory.restockDirty
            && !await confirm({ title: inventory.existingClosing?.id ? 'Cập nhật báo cáo (có chuyển kho ra quầy)?' : 'Lưu báo cáo (có chuyển kho ra quầy)?' })) return

        setIsSaving(true)
        try {
            const row = await inventory.pushInventory(profile?.id, systemTotalRevenue)
            if (!row) return // không có gì đổi (hoặc đang có push khác chạy) → isDirty giữ để thử lại
            showToast('Đã lưu báo cáo tồn kho', 'success')
            if (isGuest) {
                const filled = onboardingTargets.filter(t => {
                    const v = t.ingredient ? inventory.inventoryInputs[t.ingredient] : undefined
                    return v !== undefined && v !== '' && !inventoryProgress[t.key]
                })
                if (filled.length) setInventoryProgress(prev => ({ ...prev, ...Object.fromEntries(filled.map(t => [t.key, true])) }))
            }
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
            showToast('Đã cập nhật tồn cuối ca', 'success')
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
                    {isSaving && (
                        <div className="flex justify-end -mb-1">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide border bg-primary/10 text-primary border-primary/30">
                                <Loader2 size={11} className="animate-spin" />
                                Đang lưu
                            </span>
                        </div>
                    )}
                    {/* setTimeout: calcRef (useCounterCalc) cập nhật mẻ mới ở effect sau render — tải lại tồn quầy phải đợi nó. */}
                    {!isGuest && <TodayProduction onChanged={() => setTimeout(() => inventory.reloadStocks(), 50)} onError={showError} />}
                    <InventoryReportCard
                        ingredientsList={inventory.ingredientsList}
                        isLoading={inventory.isLoadingIngredients}
                        openingStock={inventory.openingStock}
                        openingPeriods={inventory.openingPeriods}
                        openingInputs={inventory.openingInputs}
                        openingLocked={inventory.openingLocked}
                        restockInputs={inventory.restockInputs}
                        inventoryInputs={inventory.inventoryInputs}
                        warehouseStocks={inventory.effectiveWarehouseStocks}
                        ingredientUnits={inventoryRowUnits}
                        usedMap={usedMap}
                        consumptionBreakdown={consumptionBreakdown}
                        ingredientToProduct={ingredientToProduct}
                        isSubmitting={isSaving}
                        baselineInputs={inventory.baselineSnapshot}
                        baselineVersion={inventory.baselineVersion}
                        onOpeningChange={inventory.onOpeningChange}
                        onRestockChange={inventory.onRestockChange}
                        onInventoryChange={inventory.onInventoryChange}
                        open={openAudit}
                        onToggleOpen={() => setOpenAudit(o => !o)}
                        hintIngredient={hintInventoryIngredient}
                    />

                    {!isStaff && <MissingCupSuspicionCard candidates={missingCupCandidates} />}

                    {shiftDone && (
                        <div className="flex items-center justify-center gap-2 bg-success/10 border border-success/30 px-3 py-2 rounded-[10px] text-success">
                            <span className="text-[12px] font-bold uppercase tracking-wide">✓ Đã hoàn tất ca hôm nay</span>
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

            {isTodayScope && inventory.isDirty && (
                <div
                    className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-40"
                    style={kbInset ? { transform: `translateY(-${kbInset}px)` } : undefined}
                >
                    <div className={`flex justify-end px-4 pointer-events-auto ${kbInset ? 'mb-3' : 'mb-[72px]'}`}>
                        <button
                            onClick={handleSaveInventory}
                            disabled={isSaving}
                            className="bg-primary text-black rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider hover:bg-primary/90 active:scale-95 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {isSaving ? 'Đang lưu...' : 'Lưu'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
