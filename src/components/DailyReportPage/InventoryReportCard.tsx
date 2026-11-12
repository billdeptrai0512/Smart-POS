import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, ClipboardList, Info } from 'lucide-react'
import { ingredientLabel, getIngredientUnit, lookupByLabel, normalizeIngredientCategory, INGREDIENT_CATEGORIES } from '../../utils/ingredients'
import { computeBalance, computeHaoHut, r1, type UsageMap, type buildIngredientToProduct, type calculateConsumptionBreakdown } from '../../utils/inventory'
import type { IngredientConfig } from '../../types/domain'
import type { Inputs } from '../../utils/prepToday'
import { formatVND } from '../../utils'
import { onboardingHintClass } from '../../utils/onboardingHint'
import { countedLabelVN } from '../../utils/dateVN'
import { useProducts } from '../../contexts/ProductContext'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import type { OpeningPeriods, OpeningNotes } from '../../services/counterEstimate'
import CollapsibleCard from './CollapsibleCard'
import NoticeSheet from '../common/NoticeSheet'

// Status priority for sorting collapsed list. Lower = render earlier.
// Chưa nhập first (needs action), then anomalies (Hụt/Dư), then Khớp (done).
const STATUS_PRIORITY = { pending: 0, loss: 1, excess: 2, match: 3 }

type IngredientToProduct = ReturnType<typeof buildIngredientToProduct>
type ConsumptionBreakdown = ReturnType<typeof calculateConsumptionBreakdown>
type FieldChange = (ingredient: string, value: string) => void

interface Props {
    ingredientsList: IngredientConfig[]
    isLoading?: boolean
    openingStock: UsageMap
    openingPeriods?: OpeningPeriods
    openingNotes?: OpeningNotes
    openingInputs: Inputs
    openingLocked: Record<string, boolean>
    restockInputs: Inputs
    inventoryInputs: Inputs
    warehouseStocks?: UsageMap
    ingredientUnits?: Record<string, string>
    usedMap?: UsageMap
    periodMadeMap?: UsageMap   // như madeMap nhưng cho các ngày trong kỳ kiểm kê nhiều ngày (sau ngày đếm → hết hôm qua)
    madeMap?: UsageMap       // ingredient → lượng thành phẩm làm ra hôm nay (mẻ sản xuất); đã nằm trong usedMap dưới dạng âm
    consumptionBreakdown?: ConsumptionBreakdown
    ingredientToProduct?: IngredientToProduct
    isSubmitting?: boolean
    lockWarehouseInputs?: boolean
    readOnly?: boolean
    baselineInputs?: { opening: Inputs; openingLocked: Record<string, boolean>; restock: Inputs; inventory: Inputs }
    baselineVersion?: number
    open?: boolean
    onToggleOpen?: () => void
    onOpeningChange: FieldChange
    onRestockChange: FieldChange
    onInventoryChange: FieldChange
    onFieldBlur?: () => void // rời ô Cuối kỳ → cha tự lưu (phải ổn định: IngredientRow là memo)
    hintIngredient?: string | null
    // Onboarding bước Tồn kho: sáng ô Cuối kỳ của dòng được gợi ý (xem onboarding/steps.ts).
    hintStep?: HintStep | null
    // Số gợi ý hiện vào ô Cuối kỳ của dòng được gợi ý NGAY LÚC khách bấm vào (không điền sẵn — khách chưa hiểu số từ đâu ra).
    hintFill?: number
    // Chen ngay trên "Tổng hao hụt" (vd dòng Xác nhận kiểm kê của tab).
    beforeTotal?: ReactNode
    // Dưới Tổng hao hụt, cùng cột (laptop: cột phải dính).
    afterTotal?: ReactNode
}
export type HintStep = 'count'

function computeRowStatus(args: Parameters<typeof computeHaoHut>[0]) {
    const haoHut = computeHaoHut(args)
    if (haoHut == null) return 'pending'
    if (haoHut === 0) return 'match'
    if (haoHut < 0) return 'loss'
    return 'excess'
}

// Per-ingredient layout (counter-side only — Tồn kho tách ra ngoài):
//   row 1:  Đầu kỳ    |  Nhập thêm
//   rows 2–4: [chi tiết Sử dụng theo món]  |  Sử dụng / Lý thuyết còn / Cuối kỳ (input, = Thực tế, nổi nhất)
//   (hụt/dư + tiền nằm ở nhãn tiêu đề dòng, không lặp thành ô)
//
// Staff inputs: Đầu kỳ, Nhập thêm, Cuối kỳ. Everything else is computed and disabled.
// Audit math:
//   Thực tế   = Cuối kỳ                       (đếm vật lý tại quầy)
//   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng  (lượng dự kiến còn tại quầy)
//   Hao hụt   = Thực tế − Lý thuyết           (âm = thiếu, dương = dư, 0 = khớp)
export default function InventoryReportCard({
    ingredientsList, isLoading,
    openingStock, openingPeriods = {}, openingNotes = {}, openingInputs, openingLocked,
    restockInputs, inventoryInputs,
    warehouseStocks = {},
    ingredientUnits = {},
    usedMap = {},            // ingredient → todayEstimatedConsumption qty
    madeMap = {},
    periodMadeMap = {},
    consumptionBreakdown = {}, // ingredient → { [variantKey]: { name, qty, totalAmount } } for expand-on-tap
    isSubmitting,
    // Sửa lịch sử (ngày cũ): khóa Đầu kỳ + Nhập thêm read-only, chỉ cho sửa Cuối kỳ —
    // tránh đụng kho tổng (Nhập thêm nằm trong công thức warehouse anchor).
    lockWarehouseInputs = false,
    // Xem-only toàn bảng (ngày cũ, không có quyền sửa). Khác isSubmitting ở chỗ nó là
    // trạng thái VĨNH VIỄN của lượt xem → tô kiểu "khoá" như Đầu kỳ/Nhập thêm, không
    // phải kiểu "đang bận lưu" (mờ đi). lockWarehouseInputs là ca riêng của nó.
    readOnly = false,
    // Last-persisted snapshot — drives sort + collapse so live keystrokes don't
    // re-order rows while staff is mid-edit; row key includes baselineVersion so
    // every row remounts (→ collapses) right after a successful save.
    baselineInputs, baselineVersion = 0,
    open = true, onToggleOpen,
    onOpeningChange, onRestockChange, onInventoryChange, onFieldBlur,
    // Nguyên liệu đang được onboarding phase 4 gợi ý bấm vào — xem DailyReportPage.tsx
    // (hintCoffeeIngredient) + onboarding/steps.ts.
    hintIngredient = null,
    hintStep = null, hintFill, beforeTotal, afterTotal,
}: Props) {
    // Sort by status priority so staff sees "Chưa nhập" first, then anomalies,
    // then matched rows at the bottom. Tie-break by display name for stability.
    //
    // Status is computed against the LAST-PERSISTED snapshot, not the live input
    // maps — otherwise typing a Cuối kỳ value would flip the row from Chưa nhập
    // → Hụt/Dư mid-keystroke and shuffle it down the list before staff finishes.
    // Falls back to live maps when no baseline is wired (older callers).
    // When baseline is wired these refs are stable across keystrokes, so the sort
    // (its only inputs) is memoized away — typing a Cuối kỳ value no longer re-runs
    // the O(n log n) comparator (each compare scans the maps via lookupByLabel).
    const sortOpening = baselineInputs?.opening ?? openingInputs
    const sortRestock = baselineInputs?.restock ?? restockInputs
    const sortInventory = baselineInputs?.inventory ?? inventoryInputs
    const baseStatus = useCallback((ing: IngredientConfig) => computeRowStatus({
        inventoryValue: sortInventory[ing.ingredient],
        restockValue: sortRestock[ing.ingredient],
        openingValue: sortOpening[ing.ingredient],
        openingFallback: openingStock[ing.ingredient],
        used: lookupByLabel(ing.ingredient, usedMap),
    }), [sortOpening, sortRestock, sortInventory, openingStock, usedMap])
    // Demo (guest) và Mẫu mặc định (addressId null) không có bảng ingredient_groups → chia theo 2 danh mục
    // (Nguyên liệu chính / Bao bì) và theo thứ tự ingredient_sort_order. Địa chỉ thật giữ nguyên: nhóm DB + A→Z.
    const { ingredientGroups: dbGroups } = useProducts()
    const { isGuest } = useAuth()
    const { addressId } = useAddress()
    const byCategory = isGuest || !addressId
    const sortedList = useMemo(() => [...ingredientsList].sort((a, b) => {
        const pa = STATUS_PRIORITY[baseStatus(a)]
        const pb = STATUS_PRIORITY[baseStatus(b)]
        if (pa !== pb) return pa - pb
        if (byCategory) return 0 // giữ thứ tự ingredientsList, sort ổn định
        return ingredientLabel(a.ingredient).localeCompare(ingredientLabel(b.ingredient))
    }), [ingredientsList, baseStatus, byCategory])

    // Chia section theo nhóm nguyên liệu (ingredient_groups). Địa chỉ chưa chia nhóm → sections null = danh sách phẳng như cũ.
    // Mặc định chỉ mở 1 section (nhân viên đếm theo từng kệ): section chứa NVL onboarding đang gợi ý, không thì
    // section đầu tiên còn "Chưa nhập". Tính theo baseline nên gõ số không làm section tự đóng giữa chừng;
    // lưu xong baseline đổi → mở sang section kế. `toggled` là phần người dùng bấm tay, đè mặc định.
    const [toggled, setToggled] = useState<Record<string, boolean>>({})
    const { sections, defaultOpenId } = useMemo(() => {
        const ingredientGroups = dbGroups?.length ? dbGroups : byCategory ? INGREDIENT_CATEGORIES.map(c => ({ id: c.key, name: c.label })) : null
        if (!ingredientGroups) return { sections: null, defaultOpenId: null }
        type Section = { id: string; name: string; items: IngredientConfig[] }
        const byId = new Map<string, Section>(ingredientGroups.map(g => [g.id, { id: g.id, name: g.name, items: [] }]))
        const none: Section = { id: 'none', name: 'Chưa phân nhóm', items: [] }
        for (const ing of sortedList) (byId.get(dbGroups?.length ? ing.group_id : normalizeIngredientCategory(ing.category)) || none).items.push(ing)
        const sections = [...byId.values(), none].filter(sec => sec.items.length)
        const target = (hintIngredient && sections.find(sec => sec.items.some(i => i.ingredient === hintIngredient)))
            || sections.find(sec => sec.items.some(i => baseStatus(i) === 'pending'))
        return { sections, defaultOpenId: target?.id ?? null }
    }, [dbGroups, byCategory, sortedList, baseStatus, hintIngredient])

    // Tổng giá trị hao hụt — sum |Hao hụt × unit_cost| over rows that came up short,
    // computed against LIVE inputs so the header summary tracks what staff is counting now.
    // countedCount (số NVL đã nhập Cuối kỳ) đi kèm luôn — cùng vòng lặp, cùng deps.
    // useMemo vì card này KHÔNG memo: mọi re-render của trang (gõ tiền mặt, tick chi phí…)
    // vốn chạy lại cả vòng lặp lookupByLabel này dù không có gì đổi.
    const { totalLossValue, countedCount, losses, uncounted } = useMemo(() => {
        let loss = 0
        let counted = 0
        const uncounted: string[] = []
        const losses: { key: string; name: string; qty: string; value: number }[] = []
        for (const ing of sortedList) {
            const v = inventoryInputs[ing.ingredient]
            if (v !== undefined && v !== '') counted++
            else uncounted.push(ingredientLabel(ing.ingredient))
            const haoHut = computeHaoHut({
                inventoryValue: v,
                restockValue: restockInputs[ing.ingredient],
                openingValue: openingInputs[ing.ingredient],
                openingFallback: openingStock[ing.ingredient],
                used: lookupByLabel(ing.ingredient, usedMap),
            })
            if (haoHut != null && haoHut < 0) {
                const value = Math.abs(haoHut) * (Number(ing.unit_cost) || 0)
                loss += value
                losses.push({ key: ing.ingredient, name: ingredientLabel(ing.ingredient), qty: `${Math.abs(haoHut)} ${getIngredientUnit(ing.ingredient, ing.unit, ingredientUnits)}`, value })
            }
        }
        return { totalLossValue: loss, countedCount: counted, uncounted, losses: losses.sort((a, b) => b.value - a.value) }
    }, [sortedList, inventoryInputs, restockInputs, openingInputs, openingStock, usedMap, ingredientUnits])

    // Guide: lưu xong NVL đang gợi ý (hintIngredient về null) → dòng đó tự thu (InventoryRow), cuộn xuống Tổng hao hụt
    // + thẻ Nghi vấn bán thiếu ngay dưới — phần "kết luận" của bước Kiểm kê.
    const totalRef = useRef<HTMLDivElement>(null)
    const prevHintRef = useRef(hintIngredient)
    useEffect(() => {
        if (prevHintRef.current && !hintIngredient) setTimeout(() => totalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 700) // thu dòng → ngừng 1 nhịp → mới cuộn
        prevHintRef.current = hintIngredient
    }, [hintIngredient])

    if (isLoading) {
        return (
            <div className="flex flex-col gap-3 py-4 animate-pulse">
                <div className="bg-surface-light rounded-[12px] h-8 w-1/3 mb-2" />
                <div className="bg-surface-light rounded-[20px] h-32 w-full" />
            </div>
        )
    }
    if (!ingredientsList.length) return null

    const renderRow = (ing: IngredientConfig) => (
        <IngredientRow
            key={`${ing.ingredient}-${baselineVersion}`}
            ing={ing}
            ingredientUnits={ingredientUnits}
            openingValue={openingInputs[ing.ingredient]}
            openingFallback={openingStock[ing.ingredient]}
            isLocked={openingLocked[ing.ingredient]}
            restockValue={restockInputs[ing.ingredient]}
            inventoryValue={inventoryInputs[ing.ingredient]}
            warehouseAvailable={warehouseStocks[ing.ingredient]}
            used={lookupByLabel(ing.ingredient, usedMap)}
            made={lookupByLabel(ing.ingredient, madeMap)}
            periodMade={lookupByLabel(ing.ingredient, periodMadeMap)}
            breakdown={lookupByLabel(ing.ingredient, consumptionBreakdown) || null}
            period={openingPeriods[ing.ingredient]}
            openingNote={openingNotes[ing.ingredient]}
            isSubmitting={isSubmitting}
            lockWarehouseInputs={lockWarehouseInputs}
            readOnly={readOnly}
            onOpeningChange={onOpeningChange}
            onRestockChange={onRestockChange}
            onInventoryChange={onInventoryChange}
            onFieldBlur={onFieldBlur}
            hint={ing.ingredient === hintIngredient}
            hintStep={ing.ingredient === hintIngredient ? hintStep : null}
            hintFill={ing.ingredient === hintIngredient ? hintFill : undefined}
        />
    )

    // Footer tổng — tiền hao hụt cộng dồn, chỉ hiện khi đã kiểm ít nhất 1 NVL.
    const totalRow = countedCount > 0 && (
        <div ref={totalRef} className="scroll-mt-4">
            <div className="flex items-center justify-between">
                <span className="text-[14px] font-black text-text uppercase">Tổng hao hụt</span>
                <span className={`text-[14px] font-black tabular-nums ${totalLossValue > 0 ? 'text-danger' : 'text-text-secondary'}`}>
                    {totalLossValue > 0 ? '-' : ''}{formatVND(Math.round(totalLossValue))}
                </span>
            </div>
            {losses.length > 0 ? (
                <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1">
                    {losses.map(l => (
                        <div key={l.key} className="flex items-baseline justify-between gap-2 text-[12px]">
                            <span className="text-text-secondary truncate">{l.name} <span className="text-text-dim tabular-nums">· hụt {l.qty}</span></span>
                            <span className="font-bold tabular-nums text-danger shrink-0">{l.value > 0 ? `-${formatVND(Math.round(l.value))}` : '—'}</span>
                        </div>
                    ))}
                </div>
            ) : <p className="text-[11px] mt-0.5 text-success">Khớp hết</p>}
            {uncounted.length > 0 && (
                <p className="text-[11px] mt-2 pt-2 border-t border-border/40 text-warning">Chưa kiểm kê ({uncounted.length}): {uncounted.join(', ')}</p>
            )}
        </div>
    )

    // Có nhóm → mỗi nhóm là 1 card riêng (không còn card bọc "Nguyên liệu đã sử dụng"); open/onToggleOpen của cha bỏ qua.
    if (sections) {
        return (
            <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start lg:gap-4">
                <div className="flex flex-col gap-3 min-w-0">
                {sections.map(sec => {
                    const done = sec.items.filter(i => { const v = inventoryInputs[i.ingredient]; return v !== undefined && v !== '' }).length
                    const secOpen = toggled[sec.id] ?? sec.id === defaultOpenId
                    return (
                        <CollapsibleCard
                            key={sec.id}
                            title={sec.name}
                            titleExtra={done === sec.items.length && <Check size={13} className="text-success" />}
                            count={`${done}/${sec.items.length}`}
                            open={secOpen}
                            onToggle={() => setToggled(t => ({ ...t, [sec.id]: !secOpen }))}
                        >
                            <div className="flex flex-col">{sec.items.map(renderRow)}</div>
                        </CollapsibleCard>
                    )
                })}
                </div>
                {/* Laptop+: cột phải dính đầu khung cuộn — Xác nhận + Tổng hao hụt luôn thấy khi đếm. */}
                {(beforeTotal || totalRow || afterTotal) && (
                    <div className="flex flex-col gap-3 lg:sticky lg:top-0">
                        {beforeTotal}
                        {totalRow && <div className="bg-surface rounded-[20px] px-3 py-3 border border-border/60 shadow-sm">{totalRow}</div>}
                        {afterTotal}
                    </div>
                )}
            </div>
        )
    }

    return (
        <>
        <CollapsibleCard
            icon={<ClipboardList size={15} className="text-primary shrink-0" />}
            title="Nguyên liệu đã sử dụng"
            count={`${countedCount}/${sortedList.length}`}
            open={open}
            onToggle={() => onToggleOpen?.()}
        >
            <div className="flex flex-col">{sortedList.map(renderRow)}</div>
            {beforeTotal}
            {totalRow && <div className="pt-3 mt-1 border-t border-border/40">{totalRow}</div>}
        </CollapsibleCard>
        {afterTotal}
        </>
    )
}

// memo: parent re-renders on every keystroke (input state lives in the page/hook),
// but each row gets indexed primitives + stable callbacks — so only the row being
// edited re-renders instead of all ~40. Relies on ingredientUnits/usedMap/handlers
// being referentially stable (they are: page useMemo + useShiftInventoryState useCallback).
interface RowProps {
    ing: IngredientConfig
    ingredientUnits: Record<string, string>
    openingValue?: string | number
    openingFallback?: number
    isLocked?: boolean
    restockValue?: string | number
    inventoryValue?: string | number
    warehouseAvailable?: number
    used: number
    made: number
    periodMade: number
    breakdown: ConsumptionBreakdown[string] | null
    period?: OpeningPeriods[string]
    openingNote?: OpeningNotes[string]
    isSubmitting?: boolean
    lockWarehouseInputs: boolean
    readOnly: boolean
    onOpeningChange: FieldChange
    onRestockChange: FieldChange
    onInventoryChange: FieldChange
    onFieldBlur?: () => void
    hint: boolean
    hintStep: HintStep | null
    hintFill?: number
}

const IngredientRow = memo(function IngredientRow({
    ing, ingredientUnits, openingValue, openingFallback, isLocked, restockValue, inventoryValue,
    warehouseAvailable, used, made, periodMade, breakdown, period, openingNote,
    isSubmitting, lockWarehouseInputs, readOnly,
    onOpeningChange, onRestockChange, onInventoryChange, onFieldBlur,
    hint, hintStep, hintFill,
}: RowProps) {
    // Whole-row collapse: default closed so staff can scroll the list of NVL fast and
    // open just the ones they're counting. Status badge in the header tells them
    // which rows still need "+ Cuối kỳ" input vs. already counted.
    const [open, setOpen] = useState(hint)
    // Onboarding: dòng đang được gợi ý tự mở sẵn — khỏi 1 lần bấm đi tìm ô Cuối kỳ.
    const [seenHint, setSeenHint] = useState(hint)
    const [listOpen, setListOpen] = useState(false) // sheet "Xem đủ N món" của bảng chi tiết Sử dụng
    // Hết gợi ý (đã lưu Cuối kỳ) → tự thu lại, nhường chỗ cho Tổng hao hụt bên dưới.
    if (hint !== seenHint) { setSeenHint(hint); setOpen(hint) }
    // Inline help bubble for the Lý thuyết formula — tap the (i) to toggle.
    const hasBreakdown = breakdown && Object.keys(breakdown).length > 0

    const unit = getIngredientUnit(ing.ingredient, ing.unit, ingredientUnits)
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')

    // Over-report detection: if staff types restock > kho tổng available, the difference
    // becomes a phantom deficit that absorbs future NHẬP KHO. Surface it inline.
    const restockNum = r1(restockValue)
    const warehouseNum = Number(warehouseAvailable || 0)
    const restockOverflow = warehouseAvailable !== undefined && restockNum > warehouseNum

    // Live computed balances — counter-side only. Tồn kho được tách ra khỏi
    // công thức để Lý thuyết / Thực tế cùng quy chiếu về lượng đứng tại quầy.
    //   Sử dụng   = recipe-based estimated consumption
    //   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng   (lượng dự kiến còn tại quầy)
    //   Thực tế   = Cuối kỳ                        (đếm vật lý cuối ca)
    //   Hao hụt   = Thực tế − Lý thuyết
    //               (âm = thiếu → mất hàng / công thức sai;
    //                dương = dư → nhập vượt / công thức trừ thiếu)
    // Kỳ kiểm kê (lần đếm trước cách từ 2 ngày, đầu kỳ chưa bị sửa tay): hiển thị CỘNG DỒN từ lần đếm — Đầu kỳ = số đã đếm,
    // Sử dụng = dùng cả kỳ + hôm nay, nhập thêm = đã nhập trong kỳ + nhập hôm nay. Chỉ là cách hiện; số lưu vẫn theo ngày.
    const p = isLocked ? undefined : period
    const showBreakdown = hasBreakdown
    const todayUsed = `${r1(used + r1(made))} ${unit}` // used là ròng của mẻ; cộng lại phần làm ra = phần bán, khớp bảng. bảng chi tiết chỉ có hôm nay; kỳ nhiều ngày thì khác ô Sử dụng (cộng dồn)
    const hintCount = hint && open && hintStep === 'count'
    const restockTotal = p ? restockNum + p.restock : restockNum
    const { openingNum, usedNum, lyThuyet, haoHut } = p
        ? computeBalance({ inventoryValue, restockValue: restockTotal, openingValue: p.counted, used: r1(used) + p.used })
        : computeBalance({ inventoryValue, restockValue, openingValue, openingFallback, used })
    // Thành phẩm / topping: mẻ làm ra chính là "Nhập thêm" của nó (không qua kho tổng), Sử dụng chỉ còn phần bán — Lý thuyết không đổi (usedNum là ròng). Chỉ là cách hiện, không ghi vào ô Nhập thêm đã lưu.
    const madeNum = r1(made)
    const madeAll = p ? r1(madeNum + periodMade) : madeNum   // kỳ nhiều ngày: cộng dồn cả các mẻ của kỳ
    const usedShown = r1(usedNum + madeAll)
    // Lý thuyết âm mà đếm ra dương = "dư" ảo (dùng nhiều hơn đầu kỳ + nhập → nhập hàng chưa ghi): không quy ra tiền / ly.
    const phantomDu = haoHut != null && haoHut > 0 && lyThuyet < 0

    // Money value of the discrepancy = |Hao hụt| × unit_cost. Render absolute number
    // tinted by sign so the negative magnitude is implicit in the tone.
    const unitCost = Number(ing.unit_cost) || 0
    let giaTri: number | null = null
    if (haoHut != null && !phantomDu && unitCost > 0) {
        const rawCost = Math.abs(haoHut * unitCost)
        giaTri = haoHut < 0 ? -rawCost : rawCost
    }

    // Cups-equivalent label: how many drinks of the dominant product the |Hao hụt|
    // could have made. Skips ingredients where amountPerCup is missing/1 (cup/lid passthrough).
    // Status badge text + tone for the collapsed header.
    // 'pending' uses a quiet secondary tone — "Chưa nhập" is the default state of
    // every row before staff opens chốt ca, not a problem to flag.
    let badge: { text: string; tone: 'pending' | 'good' | 'bad' | 'warn' }
    // Guide: ô Cuối kỳ cà phê được móm sẵn số gợi ý, khách chưa bấm xác nhận → coi như chưa nhập (khỏi lộ "Hụt" trước khi khách đếm).
    if (haoHut == null || (hint && hintStep === 'count')) {
        badge = { text: 'Chưa nhập', tone: 'pending' }
    } else if (haoHut === 0) {
        badge = { text: 'Khớp', tone: 'good' }
    } else if (haoHut < 0) {
        const moneyTxt = giaTri != null ? ` · ${formatVND(Math.abs(giaTri))}` : ''
        badge = { text: `Hụt ${Math.abs(haoHut)} ${unit}${moneyTxt}`, tone: 'bad' }
    } else {
        badge = { text: `Dư ${haoHut} ${unit}`, tone: 'warn' }
    }
    const badgeToneCls = {
        good: 'bg-success/10 text-success border-success/30',
        bad: 'bg-danger/10 text-danger border-danger/30',
        warn: 'bg-warning/10 text-warning border-warning/30',
        pending: 'bg-surface-light text-text-secondary border-border/60',
    }[badge.tone]

    const cellDauKy = p ? <TextCell label="Đầu kỳ" text={`${p.counted} ${unit}`} /> : (
        <ColumnInput
            label="Đầu kỳ"
            value={openingDisplay}
            unit={unit}
            disabled={isLocked || lockWarehouseInputs || readOnly}
            onChange={(v) => onOpeningChange(ing.ingredient, v)}
            onBlur={onFieldBlur}
            locked={isLocked || lockWarehouseInputs || readOnly}
        />
    )
    const cellNhap = (
        <ColumnInput
            label={p ? 'Nhập hôm nay' : 'Nhập thêm'}
            value={madeNum > 0 ? String(r1(restockNum + madeNum)) : restockValue || ''}
            unit={unit}
            disabled={lockWarehouseInputs || readOnly || madeNum > 0}
            onChange={(v) => onRestockChange(ing.ingredient, v)}
            onBlur={onFieldBlur}
            overflow={restockOverflow}
            locked={lockWarehouseInputs || readOnly || madeNum > 0}
        />
    )
    const cellSuDung = <TextCell label="Sử dụng" text={`${usedShown} ${unit}`} />
    const cellLyThuyet = <ColumnInput label="Lý thuyết còn" value={lyThuyet} unit={unit} disabled />
    const cellCuoiKy = (
        <ColumnInput
            label="Cuối kỳ"
            value={inventoryValue ?? ''}
            unit={unit}
            disabled={readOnly} // không khoá theo isSubmitting: tự lưu khi rời ô sẽ tắt luôn ô vừa được focus kế tiếp
            locked={readOnly}
            onChange={(v) => onInventoryChange(ing.ingredient, v)}
            onBlur={onFieldBlur}
            hint={hintCount}
            onHintFill={hintCount && hintFill ? () => onInventoryChange(ing.ingredient, String(hintFill)) : undefined}
            emphasis
        />
    )
    // Đầu kỳ ≠ số đếm hôm qua vì có đơn bán sau giờ đếm — cùng kiểu hàng công thức
    const openingNotePanel = !p && !isLocked && openingNote && Number(openingDisplay) === r1(openingNote.counted - openingNote.used) && (
        <div className={`px-1.5 py-3 bg-surface-light rounded-[10px] border border-border/40 flex items-center justify-between gap-0.5 text-[11px] leading-tight ${showBreakdown ? 'mb-2 flex-wrap' : 'mt-2 whitespace-nowrap'}`}>
            {[['Hôm qua', openingNote.counted], ['Sử dụng thêm', openingNote.used], ['Hôm nay', openingDisplay]].map(([label, val], i) => (
                <Fragment key={label}>
                    {i > 0 && <span className="text-[13px] font-bold text-text">{['−', '='][i - 1]}</span>}
                    <span className="flex flex-col items-center gap-1">
                        <span className="font-bold text-text-secondary">{label}</span>
                        <span className="text-[12px] font-black text-text tabular-nums">{val} {unit}</span>
                    </span>
                </Fragment>
            ))}
        </div>
    )
    const breakdownEntries = showBreakdown ? Object.values(breakdown).filter((e) => (Number(e.totalAmount) || 0) > 0).sort((a, b) => b.totalAmount - a.totalAmount) : []
    // Bảng chi tiết trải hàng 2–4 của lưới 4 hàng BẰNG NHAU: để nó dài tuỳ ý thì cả 4 hàng bị kéo cao theo → các ô nhập giãn thưa. Nên chỉ hiện các món dùng nhiều nhất, phần còn lại ẨN, bấm "Xem đủ N món" mở sheet.
    const entryRow = (entry: (typeof breakdownEntries)[number], i: number) => (
        <div key={i} className="flex flex-col">
            <span className="text-[12px] font-medium text-text leading-tight line-clamp-2">{entry.name}</span>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
                <span className="text-[10.5px] text-text-dim">{entry.qty} {entry.unitLabel ?? 'ly'} ×{r1(entry.totalAmount / entry.qty)}{unit.length <= 2 ? '' : ' '}{unit}</span>
                <span className="text-[11px] font-bold text-text">{entry.totalAmount} {unit}</span>
            </div>
        </div>
    )
    const breakdownCard = showBreakdown && (
        <div className="min-w-0 flex-1 px-2 py-2 bg-surface-light rounded-[10px] border border-border/40 flex flex-col justify-between gap-1.5">
            {p && <span className="text-[10px] font-black uppercase text-text-secondary">Hôm nay · {todayUsed}</span>}
            {breakdownEntries.slice(0, MAX_SIDE_BREAKDOWN).map(entryRow)}
            {breakdownEntries.length > MAX_SIDE_BREAKDOWN && (
                <button type="button" onClick={() => setListOpen(true)} className="text-left text-[10.5px] font-bold text-primary">Xem đủ {breakdownEntries.length} món ›</button>
            )}
        </div>
    )

    return (
        <div className="border-b border-border/20 last:border-0">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 py-2.5 group rounded-lg"
            >
                <span className="text-[14px] font-bold text-text text-left">{ingredientLabel(ing.ingredient)}</span>
                <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border tabular-nums ${badgeToneCls} ${onboardingHintClass(hint && !open)}`}>
                        {badge.text}
                    </span>
                    {open
                        ? <ChevronUp size={14} className="text-text-dim" />
                        : <ChevronDown size={14} className="text-text-dim" />
                    }
                </div>
            </button>

            {!open ? null : (<div className="pb-3">
                {p && (
                    <div className="grid grid-cols-3 gap-2 mb-2">
                        <TextCell label="Kiểm lần cuối" text={countedLabelVN(p.since)} />
                        <div className="col-span-2">
                            <TextCell label="Đã nhập thêm" text={`${r1(p.restock + periodMade)} ${unit}`} />
                        </div>
                    </div>
                )}

                {showBreakdown ? (<>
                    {openingNotePanel}
                    {/* Có chi tiết món: lưới 2 cột bằng nhau × 4 hàng bằng nhau. Cột phải = 4 ô cách đều; cột trái = Đầu kỳ (hàng 1) + bảng chi tiết trải hàng 2–4 (đỉnh–đáy thẳng với Sử dụng–Cuối kỳ). Hụt/dư + tiền đã nằm ở nhãn tiêu đề dòng. */}
                    <div className="grid grid-cols-2 grid-rows-4 items-center gap-2">
                        <div className="col-start-1 row-start-1">{cellDauKy}</div>
                        <div className="col-start-2 row-start-1">{cellNhap}</div>
                        <div className="col-start-1 row-start-2 row-span-3 self-stretch min-w-0 flex flex-col">{breakdownCard}</div>
                        <div className="col-start-2 row-start-2">{cellSuDung}</div>
                        <div className="col-start-2 row-start-3">{cellLyThuyet}</div>
                        <div className="col-start-2 row-start-4">{cellCuoiKy}</div>
                    </div>
                </>) : (<>
                    {/* Không có chi tiết món: cùng 2 cột — Đầu kỳ | Nhập thêm ; Sử dụng | Lý thuyết còn ; Cuối kỳ trải cả hàng. */}
                    {openingNotePanel}
                    <div className="grid grid-cols-2 gap-2">
                        {cellDauKy}{cellNhap}{cellSuDung}{cellLyThuyet}
                        <div className="col-span-2">{cellCuoiKy}</div>
                    </div>
                </>)}
            </div>)}
            {listOpen && (
                <NoticeSheet icon={<ClipboardList size={18} className="text-primary shrink-0" />} title={`${ingredientLabel(ing.ingredient)} · Sử dụng`} count={p ? todayUsed : `${r1(usedNum)} ${unit}`} onClose={() => setListOpen(false)}>
                    <div className="flex flex-col gap-3 pb-2">{breakdownEntries.map(entryRow)}</div>
                </NoticeSheet>
            )}
        </div>
    )
})

// tone → wrapper classes (no border-width, callers add `border`) + text color classes.
// ColumnInput's neutral tone is intentionally empty so locked/overflow styling shows through;
// TextCell falls back to a grey box instead.
const MAX_SIDE_BREAKDOWN = 3 // bảng chi tiết món chỉ hiện tối đa bấy nhiêu món (nhiều nhất trước), còn lại ẩn
type ToneCls = { wrap: string; text: string; unit: string }
const TONE: Record<string, ToneCls> = {
    good: { wrap: 'bg-success/8 border-success/30', text: 'text-success', unit: 'text-success/70' },
    bad: { wrap: 'bg-danger/8 border-danger/30', text: 'text-danger', unit: 'text-danger/70' },
    warn: { wrap: 'bg-warning/8 border-warning/30', text: 'text-warning', unit: 'text-warning/70' },
}

interface ColumnInputProps {
    label: string
    value?: string | number
    unit: string
    disabled?: boolean
    locked?: boolean
    onChange?: (value: string) => void
    onBlur?: () => void
    overflow?: boolean
    tone?: string
    onBoxClick?: () => void
    hint?: boolean | 'soft'
    onHintFill?: () => void // guide: ô đang sáng còn trống → bấm vào mới hiện số gợi ý, ~0,7s sau tự rời ô (= lưu)
    emphasis?: boolean // ô chính của thao tác (Cuối kỳ): viền + nền cam nhạt, số đậm hơn
}

function ColumnInput({ label, value, unit, disabled, locked, onChange, onBlur, overflow, tone = 'neutral', onBoxClick, hint = false, onHintFill, emphasis = false }: ColumnInputProps) {
    // tone overrides the default disabled coloring for read-only diff cells.
    const t: Partial<ToneCls> = TONE[tone] || {}

    const wrapCls = overflow
        ? 'bg-danger/5 border border-danger/40 focus-within:border-danger'
        : t.wrap
            ? `border ${t.wrap}`
            : locked
                ? 'bg-primary/8 border border-primary/30'
                : emphasis
                    ? 'bg-primary/10 border border-primary/50 focus-within:border-primary'
                    : 'bg-surface-light border border-border/60 focus-within:border-primary/40'
    const inputCls = overflow ? 'text-danger' : t.text || (locked ? 'text-primary cursor-not-allowed' : 'text-text')
    const unitCls = overflow ? 'text-danger/70' : t.unit || (locked ? 'text-primary/70' : 'text-text-dim')
    const Box = onBoxClick ? 'div' : 'label'

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-center gap-1 mb-1">
                <span className="text-[10px] font-black uppercase text-text-secondary">{label}</span>
            </div>
            {/* <label> để bấm chỗ nào trong ô cũng focus vào input — input tự co theo số
                (width tính bằng ch) nên đơn vị luôn nằm sát ngay sau số, cả cụm canh giữa.
                (i) đặt absolute để số + đơn vị vẫn canh giữa như các ô khác.
                Ô bấm được phải là <div>: Chrome nuốt click trên <label> khi input bên trong disabled. */}
            <Box
                onClick={onBoxClick}
                className={`relative flex items-center justify-center rounded-[10px] overflow-hidden transition-all gap-1 px-1.5 py-1.5 ${wrapCls} ${onBoxClick ? 'pr-3 cursor-pointer' : ''} ${onboardingHintClass(hint === true)}`}
            >
                <input
                    type="number"
                    placeholder="-"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    onBlur={onBlur}
                    // Guide khách dùng thử: ô đang sáng — trống thì hiện số gợi ý rồi tự rời ô (blur = lưu); đã có số thì bấm vào là xác nhận.
                    onFocus={hint === true && onBlur && (value !== '' || onHintFill) ? e => {
                        const el = e.currentTarget
                        if (value === '') { onHintFill?.(); setTimeout(() => el.blur(), 700) } else el.blur()
                    } : undefined}
                    onKeyDown={onBlur ? e => { if (e.key === 'Enter') e.currentTarget.blur() } : undefined} // Enter/"Đi" không mất focus → tự blur để kích hoạt lưu
                    disabled={disabled}
                    style={{ width: `${Math.max(String(value ?? '').length, 1)}ch` }}
                    className={`min-w-0 bg-transparent text-[13px] ${emphasis ? 'font-black' : 'font-bold'} text-center placeholder:text-text-secondary/40 focus:outline-none no-spin ${tone === 'neutral' ? 'disabled:opacity-50' : ''} ${inputCls}`}
                />
                <span className={`text-[10px] font-medium shrink-0 ${unitCls}`}>{unit}</span>
                {onBoxClick && <Info size={10} className={`absolute right-1.5 text-text-dim pointer-events-none ${onboardingHintClass(hint === 'soft', 'soft')}`} />}
            </Box>
        </div>
    )
}

// Read-only text cell that visually matches ColumnInput (same label+box rhythm) but
// renders a string instead of a number input. Used for "Tương đương N ly <product>".
function TextCell({ label, text, tone = 'neutral', onClick, expanded = false, hint = false }: { label: string; text: ReactNode; tone?: string; onClick?: () => void; expanded?: boolean; hint?: boolean | 'soft' }) {
    const t: Partial<ToneCls> = TONE[tone] || { wrap: 'bg-surface-light border-border/60', text: 'text-text-secondary' }
    const interactive = typeof onClick === 'function'
    const boxClasses = `w-full rounded-[10px] py-1.5 px-2 text-[13px] text-center font-bold border ${t.wrap} ${t.text}${interactive ? ' relative flex items-center justify-center hover:brightness-110 active:scale-[0.99] transition' : ''}`
    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-center gap-1 mb-1">
                <span className="text-[10px] font-black uppercase text-text-secondary">{label}</span>
            </div>
            {interactive ? (
                <button type="button" onClick={onClick} className={`${boxClasses} ${onboardingHintClass(hint === true)}`}>
                    <span className="truncate">{text}</span>
                    <ChevronDown size={11} className={`absolute right-2 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} ${onboardingHintClass(hint === 'soft', 'soft')}`} />
                </button>
            ) : (
                <div className={boxClasses}>{text}</div>
            )}
        </div>
    )
}

