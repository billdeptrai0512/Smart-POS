import { memo, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ClipboardList, Info } from 'lucide-react'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { formatPackedQty } from '../../utils/inventory'
import { formatVND } from '../../utils'
import CollapsibleCard from './CollapsibleCard'

// Status priority for sorting collapsed list. Lower = render earlier.
// Chưa nhập first (needs action), then anomalies (Hụt/Dư), then Khớp (done).
const STATUS_PRIORITY = { pending: 0, loss: 1, excess: 2, match: 3 }

const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// Hao hụt = Thực tế − Lý thuyết. Returns null when staff hasn't counted Cuối kỳ yet
// (inventoryValue empty/undefined) — caller treats null as "pending", not 0.
function computeHaoHut({ inventoryValue, restockValue, openingValue, openingFallback, used }) {
    const hasActual = inventoryValue !== undefined && inventoryValue !== ''
    if (!hasActual) return null
    const restockNum = r1(restockValue)
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')
    const openingNum = r1(openingDisplay)
    const usedNum = r1(used)
    const thucTe = r1(inventoryValue)
    const lyThuyet = r1(openingNum + restockNum - usedNum)
    return r1(thucTe - lyThuyet)
}

function computeRowStatus(args) {
    const haoHut = computeHaoHut(args)
    if (haoHut == null) return 'pending'
    if (haoHut === 0) return 'match'
    if (haoHut < 0) return 'loss'
    return 'excess'
}

// Per-ingredient layout (counter-side only — Tồn kho tách ra ngoài):
//   row 1 (inputs):  Đầu kỳ    |  Nhập thêm   |  Cuối kỳ
//   row 2:           Sử dụng   |  Tổng cộng (col-span 2)
//   row 3 (audit):   Chênh lệch|  Lý thuyết   |  Thực tế
//
// Staff inputs: Đầu kỳ, Nhập thêm, Cuối kỳ. Everything else is computed and disabled.
// Audit math:
//   Thực tế   = Cuối kỳ                       (đếm vật lý tại quầy)
//   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng  (lượng dự kiến còn tại quầy)
//   Hao hụt   = Thực tế − Lý thuyết           (âm = thiếu, dương = dư, 0 = khớp)
export default function InventoryReportCard({
    ingredientsList, isLoading,
    openingStock, openingInputs, openingLocked,
    restockInputs, inventoryInputs,
    warehouseStocks = {},
    ingredientUnits = {},
    usedMap = {},            // ingredient → todayEstimatedConsumption qty
    consumptionBreakdown = {}, // ingredient → { [variantKey]: { name, qty, totalAmount } } for expand-on-tap
    ingredientToProduct = {}, // ingredient → { amountPerCup, productName } for "Tương đương N ly" label
    canUnlock, isSubmitting,
    // Sửa lịch sử (ngày cũ): khóa Đầu kỳ + Nhập thêm read-only, chỉ cho sửa Cuối kỳ —
    // tránh đụng kho tổng (Nhập thêm nằm trong công thức warehouse anchor).
    lockWarehouseInputs = false,
    // Last-persisted snapshot — drives sort + collapse so live keystrokes don't
    // re-order rows while staff is mid-edit; row key includes baselineVersion so
    // every row remounts (→ collapses) right after a successful save.
    baselineInputs, baselineVersion = 0,
    open = true, onToggleOpen,
    onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
}) {
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
    const sortedList = useMemo(() => [...ingredientsList].sort((a, b) => {
        const sa = computeRowStatus({
            inventoryValue: sortInventory[a.ingredient],
            restockValue: sortRestock[a.ingredient],
            warehouseAvailable: warehouseStocks[a.ingredient],
            openingValue: sortOpening[a.ingredient],
            openingFallback: openingStock[a.ingredient],
            used: lookupByLabel(a.ingredient, usedMap),
        })
        const sb = computeRowStatus({
            inventoryValue: sortInventory[b.ingredient],
            restockValue: sortRestock[b.ingredient],
            warehouseAvailable: warehouseStocks[b.ingredient],
            openingValue: sortOpening[b.ingredient],
            openingFallback: openingStock[b.ingredient],
            used: lookupByLabel(b.ingredient, usedMap),
        })
        const pa = STATUS_PRIORITY[sa]
        const pb = STATUS_PRIORITY[sb]
        if (pa !== pb) return pa - pb
        return ingredientLabel(a.ingredient).localeCompare(ingredientLabel(b.ingredient))
    }), [ingredientsList, sortOpening, sortRestock, sortInventory, warehouseStocks, openingStock, usedMap])

    if (isLoading) {
        return (
            <div className="flex flex-col gap-3 py-4 animate-pulse">
                <div className="bg-surface-light rounded-[12px] h-8 w-1/3 mb-2" />
                <div className="bg-surface-light rounded-[20px] h-32 w-full" />
            </div>
        )
    }
    if (!ingredientsList.length) return null

    // Tổng giá trị hao hụt — sum |Hao hụt × unit_cost| over rows that came up short,
    // computed against LIVE inputs so the header summary tracks what staff is counting now.
    let totalLossValue = 0
    for (const ing of sortedList) {
        const haoHut = computeHaoHut({
            inventoryValue: inventoryInputs[ing.ingredient],
            restockValue: restockInputs[ing.ingredient],
            openingValue: openingInputs[ing.ingredient],
            openingFallback: openingStock[ing.ingredient],
            used: lookupByLabel(ing.ingredient, usedMap),
        })
        if (haoHut != null && haoHut < 0) {
            const rawCost = Math.abs(haoHut) * (Number(ing.unit_cost) || 0)
            totalLossValue += rawCost
        }
    }

    // Số NVL đã kiểm (có nhập Cuối kỳ) — drives header summary, song song với
    // "X món · Y đã soạn" của ShiftPrepCard.
    const countedCount = sortedList.reduce((n, ing) => {
        const v = inventoryInputs[ing.ingredient]
        return n + (v !== undefined && v !== '' ? 1 : 0)
    }, 0)

    return (
        <CollapsibleCard
            icon={<ClipboardList size={15} className="text-primary shrink-0" />}
            title="Kiểm kê tồn kho"
            count={`${countedCount}/${sortedList.length}`}
            open={open}
            onToggle={onToggleOpen}
        >
            <div className="flex flex-col">
            {sortedList.map(ing => (
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
                    breakdown={lookupByLabel(ing.ingredient, consumptionBreakdown) || null}
                    productRef={ingredientToProduct[ing.ingredient]}
                    canUnlock={canUnlock}
                    isSubmitting={isSubmitting}
                    lockWarehouseInputs={lockWarehouseInputs}
                    onOpeningChange={onOpeningChange}
                    onOpeningLock={onOpeningLock}
                    onRestockChange={onRestockChange}
                    onInventoryChange={onInventoryChange}
                />
            ))}
            </div>

            {/* Footer tổng — tiền hao hụt cộng dồn, chỉ hiện khi đã kiểm ít nhất 1 NVL. */}
            {countedCount > 0 && (
                <div className="flex items-center justify-between pt-3 mt-1 border-t border-border/40">
                    <span className="text-[12px] font-bold text-text-secondary">Tổng cộng</span>
                    <span className={`text-[14px] font-black tabular-nums ${totalLossValue > 0 ? 'text-danger' : 'text-text-secondary'}`}>
                        {totalLossValue > 0 ? '-' : ''}{formatVND(Math.round(totalLossValue))}
                    </span>
                </div>
            )}
        </CollapsibleCard>
    )
}

// Fallback when exact ingredient key has no consumption — match by display label.
// Same pattern as InventoryRefillCard: recipes might use 'condensed_milk_ml' while inventory
// tracks 'sữa_đặc'; both label to "Sữa đặc" so lookup by display avoids a 0 false-negative.
function lookupByLabel(ingredient, map) {
    if (!map) return 0
    if (map[ingredient] != null) return map[ingredient]
    const label = ingredientLabel(ingredient).toLowerCase()
    for (const [key, val] of Object.entries(map)) {
        if (key !== ingredient && ingredientLabel(key).toLowerCase() === label) return val
    }
    return 0
}

// memo: parent re-renders on every keystroke (input state lives in the page/hook),
// but each row gets indexed primitives + stable callbacks — so only the row being
// edited re-renders instead of all ~40. Relies on ingredientUnits/usedMap/handlers
// being referentially stable (they are: page useMemo + useShiftInventoryState useCallback).
const IngredientRow = memo(function IngredientRow({
    ing, ingredientUnits, openingValue, openingFallback, isLocked, restockValue, inventoryValue,
    warehouseAvailable, used, breakdown, productRef,
    isSubmitting, lockWarehouseInputs,
    onOpeningChange, onRestockChange, onInventoryChange,
}) {
    // Whole-row collapse: default closed so staff can scroll the list of NVL fast and
    // open just the ones they're counting. Status badge in the header tells them
    // which rows still need "+ Cuối kỳ" input vs. already counted.
    const [open, setOpen] = useState(false)
    // Sub-expand: per-recipe consumption breakdown inside the expanded row.
    const [expanded, setExpanded] = useState(false)
    // Inline help bubble for the Lý thuyết formula — tap the (i) to toggle.
    const [showLyThuyetInfo, setShowLyThuyetInfo] = useState(false)
    const hasBreakdown = breakdown && Object.keys(breakdown).length > 0
    const toggleExpanded = () => hasBreakdown && setExpanded(e => !e)

    const unit = getIngredientUnit(ing.ingredient, ing.unit, ingredientUnits)
    const packSize = Number(ing.pack_size || 0)
    const packUnit = ing.pack_unit
    const fmt = (n) => formatPackedQty(n, packSize, packUnit, unit, { compact: true })
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')

    // Over-report detection: if staff types restock > kho tổng available, the difference
    // becomes a phantom deficit that absorbs future NHẬP KHO. Surface it inline.
    const restockNum = r1(restockValue)
    const warehouseNum = Number(warehouseAvailable || 0)
    const restockOverflow = warehouseAvailable !== undefined && restockNum > warehouseNum
    const overBy = restockOverflow ? restockNum - warehouseNum : 0

    // Live computed balances — counter-side only. Tồn kho được tách ra khỏi
    // công thức để Lý thuyết / Thực tế cùng quy chiếu về lượng đứng tại quầy.
    //   Sử dụng   = recipe-based estimated consumption
    //   Lý thuyết = Đầu kỳ + Nhập thêm − Sử dụng   (lượng dự kiến còn tại quầy)
    //   Thực tế   = Cuối kỳ                        (đếm vật lý cuối ca)
    //   Hao hụt   = Thực tế − Lý thuyết
    //               (âm = thiếu → mất hàng / công thức sai;
    //                dương = dư → nhập vượt / công thức trừ thiếu)
    const openingNum = r1(openingDisplay)
    const usedNum = r1(used)
    const hasActual = inventoryValue !== undefined && inventoryValue !== ''
    const cuoiKyNum = hasActual ? r1(inventoryValue) : null
    const thucTe = cuoiKyNum != null ? r1(cuoiKyNum) : null
    const lyThuyet = r1(openingNum + restockNum - usedNum)
    const haoHut = thucTe != null ? r1(thucTe - lyThuyet) : null
    const haoHutTone = haoHut == null
        ? 'neutral'
        : haoHut === 0 ? 'good' : haoHut < 0 ? 'bad' : 'warn'

    // Money value of the discrepancy = |Hao hụt| × unit_cost. Render absolute number
    // tinted by sign so the negative magnitude is implicit in the tone.
    const unitCost = Number(ing.unit_cost) || 0
    let giaTri = null
    if (haoHut != null && unitCost > 0) {
        const rawCost = Math.abs(haoHut * unitCost)
        giaTri = haoHut < 0 ? -rawCost : rawCost
    }

    // Cups-equivalent label: how many drinks of the dominant product the |Hao hụt|
    // could have made. Skips ingredients where amountPerCup is missing/1 (cup/lid passthrough).
    let tuongDuongText = '—'
    if (haoHut != null && productRef?.amountPerCup > 0 && haoHut !== 0) {
        const cups = Math.round(Math.abs(haoHut) / productRef.amountPerCup)
        if (cups > 0) tuongDuongText = `≈ ${cups} ly ${productRef.productName || ''}`.trim()
    }

    // Tổng cộng cell text: total cups across all variants that consumed this ingredient
    // today (sum of breakdown[*].qty). Variants with totalAmount === 0 (e.g. size LỚN /
    // BÌNH NHỎ that don't draw on this unit) are excluded — counting them would inflate
    // the cup total above "Sử dụng" even though they consumed nothing. Tap to expand.
    const totalCupsUsing = hasBreakdown
        ? Object.values(breakdown).reduce(
            (sum, e) => sum + ((Number(e.totalAmount) || 0) > 0 ? (Number(e.qty) || 0) : 0),
            0,
        )
        : 0
    const totalCupsText = totalCupsUsing > 0 ? `${totalCupsUsing} ly` : '—'

    // Status badge text + tone for the collapsed header.
    // 'pending' uses a quiet secondary tone — "Chưa nhập" is the default state of
    // every row before staff opens chốt ca, not a problem to flag.
    let badge
    if (!hasActual) {
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

    return (
        <div className="border-b border-border/20 last:border-0">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 py-2.5 group"
            >
                <span className="text-[14px] font-bold text-text text-left">{ingredientLabel(ing.ingredient)}</span>
                <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border tabular-nums ${badgeToneCls}`}>
                        {badge.text}
                    </span>
                    {open
                        ? <ChevronUp size={14} className="text-text-dim" />
                        : <ChevronDown size={14} className="text-text-dim" />
                    }
                </div>
            </button>

            {!open ? null : (<div className="pb-3">
                {/* Row 1 — warehouse level */}
                <div className="grid grid-cols-3 gap-2">
                    <ColumnInput
                        label="Đầu kỳ"
                        value={openingDisplay}
                        unit={unit}
                        disabled={isLocked || isSubmitting || lockWarehouseInputs}
                        onChange={(v) => onOpeningChange(ing.ingredient, v)}
                        locked={isLocked || lockWarehouseInputs}
                    />
                    <ColumnInput
                        label="Nhập thêm"
                        value={restockValue || ''}
                        unit={unit}
                        disabled={isSubmitting || lockWarehouseInputs}
                        onChange={(v) => onRestockChange(ing.ingredient, v)}
                        overflow={restockOverflow}
                        locked={lockWarehouseInputs}
                    />
                    <ColumnInput
                        label="Cuối kỳ"
                        value={inventoryValue ?? ''}
                        unit={unit}
                        disabled={isSubmitting}
                        onChange={(v) => onInventoryChange(ing.ingredient, v)}
                    />
                </div>

                {/* Row 2 — counter level */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                    <ColumnInput
                        label="Sử dụng"
                        value={usedNum}
                        unit={unit}
                        disabled
                    />
                    <div className="col-span-2">
                        <TextCell
                            label="Tổng cộng"
                            text={totalCupsText}
                            onClick={hasBreakdown ? toggleExpanded : undefined}
                            expanded={expanded}
                        />
                    </div>

                </div>

                {expanded && hasBreakdown && (
                    <div className="mt-2 px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 flex flex-col gap-1">
                        {Object.values(breakdown)
                            .filter((e) => (Number(e.totalAmount) || 0) > 0)
                            .sort((a, b) => b.totalAmount - a.totalAmount)
                            .map((entry, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <span className="text-[11px] text-text-secondary truncate flex-1">{entry.name}</span>
                                    <span className="text-[11px] font-bold text-text-dim tabular-nums shrink-0 ml-2">
                                        {entry.qty} ly × {Math.round(entry.totalAmount / entry.qty * 10) / 10} = <span className="text-text font-black">{entry.totalAmount}</span>
                                    </span>
                                </div>
                            ))
                        }
                    </div>
                )}

                {/* Row 3 — audit: Hao hụt | Lý thuyết | Thực tế */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                    <ColumnInput
                        label="Chênh lệch"
                        value={haoHut != null ? haoHut : ''}
                        unit={unit}
                        disabled
                        tone={haoHutTone}
                    />
                    <ColumnInput
                        label="Lý thuyết"
                        value={lyThuyet}
                        unit={unit}
                        disabled
                        onLabelClick={() => setShowLyThuyetInfo(s => !s)}
                        labelTrailing={<Info size={10} className="text-text-dim shrink-0" />}
                    />
                    <ColumnInput
                        label="Thực tế"
                        value={thucTe != null ? thucTe : ''}
                        unit={unit}
                        disabled
                    />
                </div>
                {showLyThuyetInfo && (
                    <div className="mt-2 px-3 py-2 bg-surface-light rounded-[10px] text-center border border-border/40 text-[11px] text-text-secondary leading-snug">
                        Đầu kỳ <span className="text-text-dim">({openingNum})</span>
                        {' '}+ Nhập thêm <span className="text-text-dim">({restockNum})</span>
                        {' '}− Sử dụng <span className="text-text-dim">({usedNum})</span>
                    </div>
                )}
                {/* Row 4 — money + cups-equivalent context for Hao hụt */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                    <TextCell
                        label="Giá trị"
                        text={giaTri != null
                            ? `${giaTri < 0 ? '-' : ''}${formatVND(Math.abs(giaTri))}`
                            : '—'}
                        tone={haoHutTone}
                    />
                    <div className="col-span-2">
                        <TextCell label="Tương đương" text={tuongDuongText} tone={haoHutTone} />
                    </div>
                </div>

                {restockOverflow && (
                    <div className="flex items-start gap-1.5 mt-1.5 text-[10px] font-bold text-danger leading-tight">
                        <AlertTriangle size={11} className="mt-[1px] shrink-0" />
                        <span>
                            Vượt kho tổng {fmt(overBy)}.
                            Nếu hàng được mua mới, vào <span className="underline">/ingredients → + Nhập kho</span> trước.
                        </span>
                    </div>
                )}
            </div>)}
        </div>
    )
})

function ColumnInput({ label, value, unit, disabled, locked, onChange, headerRight, overflow, tone = 'neutral', onLabelClick, labelTrailing }) {
    // tone overrides the default disabled coloring for read-only diff cells.
    const toneMap = {
        good: { wrap: 'bg-success/8 border border-success/30', input: 'text-success', unit: 'text-success/70' },
        bad: { wrap: 'bg-danger/8 border border-danger/30', input: 'text-danger', unit: 'text-danger/70' },
        warn: { wrap: 'bg-warning/8 border border-warning/30', input: 'text-warning', unit: 'text-warning/70' },
        neutral: { wrap: '', input: '', unit: '' },
    }
    const t = toneMap[tone] || toneMap.neutral

    const wrapCls = overflow
        ? 'bg-danger/5 border border-danger/40 focus-within:border-danger'
        : t.wrap
            ? t.wrap
            : locked
                ? 'bg-primary/8 border border-primary/30'
                : 'bg-surface-light border border-border/60 focus-within:border-primary/40'
    const inputCls = overflow ? 'text-danger' : t.input || (locked ? 'text-primary cursor-not-allowed' : 'text-text')
    const unitCls = overflow ? 'text-danger/70' : t.unit || (locked ? 'text-primary/70' : 'text-text-dim')

    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={onLabelClick}
                disabled={!onLabelClick}
                className="flex items-center justify-center gap-1 mb-1 disabled:cursor-default"
            >
                <span className={`text-[9px] font-black uppercase ${onLabelClick ? 'text-text' : 'text-text-dim'}`}>{label}</span>
                {labelTrailing || headerRight}
            </button>
            <div className={`flex items-center rounded-[10px] overflow-hidden transition-all gap-1 ${wrapCls}`}>
                <input
                    type="number"
                    placeholder="-"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    disabled={disabled}
                    className={`flex-1 min-w-0 bg-transparent pl-2 py-1.5 text-[13px] font-bold text-right placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${tone === 'neutral' ? 'disabled:opacity-50' : ''} ${inputCls}`}
                />
                <span className={`pr-1.5 text-[10px] font-medium shrink-0 ${unitCls}`}>{unit}</span>
            </div>
        </div>
    )
}

// Read-only text cell that visually matches ColumnInput (same label+box rhythm) but
// renders a string instead of a number input. Used for "Tương đương N ly <product>".
function TextCell({ label, text, tone = 'neutral', onClick, expanded = false }) {
    const toneMap = {
        good: { wrap: 'bg-success/8 border-success/30', text: 'text-success' },
        bad: { wrap: 'bg-danger/8 border-danger/30', text: 'text-danger' },
        warn: { wrap: 'bg-warning/8 border-warning/30', text: 'text-warning' },
        neutral: { wrap: 'bg-surface-light border-border/60', text: 'text-text-secondary' },
    }
    const t = toneMap[tone] || toneMap.neutral
    const interactive = typeof onClick === 'function'
    const boxClasses = `w-full rounded-[10px] py-1.5 px-2 text-[13px] text-center font-bold border ${t.wrap} ${t.text}${interactive ? ' flex items-center justify-end gap-1 hover:brightness-110 active:scale-[0.99] transition' : ''}`
    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-center gap-1 mb-1">
                <span className="text-[9px] font-black uppercase text-text-dim">{label}</span>
            </div>
            {interactive ? (
                <button type="button" onClick={onClick} className={boxClasses}>
                    <span className="flex-1 truncate">≈ {text}</span>
                    <ChevronDown size={11} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
            ) : (
                <div className={boxClasses}>{text}</div>
            )}
        </div>
    )
}

