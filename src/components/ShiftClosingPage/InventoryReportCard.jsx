import { useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { ingredientLabel, getIngredientUnit } from '../common/recipeUtils'
import { formatPackedQty } from '../../utils/inventory'

// 3×3 grid per ingredient:
//   row 1 (warehouse):  Tồn kho   |  Lấy ra      |  Tồn cuối = Tồn kho − Lấy ra
//   row 2 (counter):    Đầu kỳ    |  Sử dụng     |  + Cuối kỳ = actual đếm quầy (input)
//   row 3 (audit):      Hao hụt   |  Lý thuyết   |  Thực tế
//
// Staff inputs: Lấy ra, Đầu kỳ, "+ Cuối kỳ". Everything else is computed and disabled.
// Audit math:
//   Thực tế   = Tồn cuối + Cuối kỳ          (tổng tồn vật lý cuối ca)
//   Lý thuyết = Tồn cuối + Đầu kỳ − Sử dụng (tồn dự kiến theo công thức)
//   Hao hụt   = Thực tế − Lý thuyết         (âm = thiếu, dương = dư, 0 = khớp)
export default function InventoryReportCard({
    ingredientsList, isLoading,
    openingStock, openingInputs, openingLocked,
    restockInputs, inventoryInputs,
    warehouseStocks = {},
    ingredientUnits = {},
    usedMap = {},            // ingredient → todayEstimatedConsumption qty
    consumptionBreakdown = {}, // ingredient → { [variantKey]: { name, qty, totalAmount } } for expand-on-tap
    canUnlock, isSubmitting,
    onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
}) {
    if (isLoading) {
        return (
            <div className="flex flex-col gap-3 py-4 animate-pulse">
                <div className="bg-surface-light rounded-[12px] h-8 w-1/3 mb-2" />
                <div className="bg-surface-light rounded-[20px] h-32 w-full" />
            </div>
        )
    }
    if (!ingredientsList.length) return null

    return (
        <div className="bg-surface rounded-[20px] p-3 border border-border/60 shadow-sm space-y-3">
            {ingredientsList.map(ing => (
                <IngredientRow
                    key={ing.ingredient}
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
                    canUnlock={canUnlock}
                    isSubmitting={isSubmitting}
                    onOpeningChange={onOpeningChange}
                    onOpeningLock={onOpeningLock}
                    onRestockChange={onRestockChange}
                    onInventoryChange={onInventoryChange}
                />
            ))}
        </div>
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

function IngredientRow({
    ing, ingredientUnits, openingValue, openingFallback, isLocked, restockValue, inventoryValue,
    warehouseAvailable, used, breakdown,
    isSubmitting,
    onOpeningChange, onRestockChange, onInventoryChange,
}) {
    // Tap Sử dụng to expand the per-recipe breakdown (which products consumed this ingredient today).
    const [expanded, setExpanded] = useState(false)
    const hasBreakdown = breakdown && Object.keys(breakdown).length > 0
    const toggleExpanded = () => hasBreakdown && setExpanded(e => !e)

    const unit = getIngredientUnit(ing.ingredient, ing.unit, ingredientUnits)
    const packSize = Number(ing.pack_size || 0)
    const packUnit = ing.pack_unit
    const fmt = (n) => formatPackedQty(n, packSize, packUnit, unit, { compact: true })
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')

    // Round to 1 decimal so noisy float math doesn't surface in the UI.
    const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10

    // Over-report detection: if staff types restock > kho tổng available, the difference
    // becomes a phantom deficit that absorbs future NHẬP KHO. Surface it inline.
    const restockNum = r1(restockValue)
    const warehouseNum = Number(warehouseAvailable || 0)
    const restockOverflow = warehouseAvailable !== undefined && restockNum > warehouseNum
    const overBy = restockOverflow ? restockNum - warehouseNum : 0

    // Live computed balances.
    //   warehouseEnd = Tồn kho − Lấy ra   (kho tổng còn sau khi rút)
    //   Sử dụng      = recipe-based estimated consumption
    //   Thực tế      = Tồn cuối + Cuối kỳ (đếm vật lý cuối ca)
    //   Lý thuyết    = (Tồn cuối + Đầu kỳ) − Sử dụng
    //   Hao hụt      = Thực tế − Lý thuyết
    //                 (âm = thiếu → mất hàng / công thức sai;
    //                  dương = dư → restock vượt / công thức trừ thiếu)
    const warehouseEnd = Math.max(0, warehouseNum - restockNum)
    const openingNum = r1(openingDisplay)
    const usedNum = r1(used)
    const hasActual = inventoryValue !== undefined && inventoryValue !== ''
    const cuoiKyNum = hasActual ? r1(inventoryValue) : null
    const thucTe = cuoiKyNum != null ? r1(warehouseEnd + cuoiKyNum) : null
    const lyThuyet = r1(warehouseEnd + openingNum - usedNum)
    const haoHut = thucTe != null ? r1(thucTe - lyThuyet) : null
    const haoHutTone = haoHut == null
        ? 'neutral'
        : haoHut === 0 ? 'good' : haoHut < 0 ? 'bad' : 'warn'

    return (
        <div className="border-b border-border/20 last:border-0 pb-2.5 last:pb-0">
            <div className="flex items-baseline justify-between mb-1.5 gap-2">
                <span className="text-[16px] font-bold text-text">{ingredientLabel(ing.ingredient)}</span>
            </div>

            {/* Row 1 — warehouse level */}
            <div className="grid grid-cols-3 gap-2">
                <ColumnInput label="Tồn kho" value={warehouseNum} unit={unit} disabled />
                <ColumnInput
                    label="Lấy ra"
                    value={restockValue || ''}
                    unit={unit}
                    disabled={isSubmitting}
                    onChange={(v) => onRestockChange(ing.ingredient, v)}
                    overflow={restockOverflow}
                />
                <ColumnInput label="Tồn cuối" value={warehouseEnd} unit={unit} disabled />
            </div>

            {/* Row 2 — counter level */}
            <div className="grid grid-cols-3 gap-2 mt-2">
                <ColumnInput
                    label="Đầu kỳ"
                    value={openingDisplay}
                    unit={unit}
                    disabled={isLocked || isSubmitting}
                    onChange={(v) => onOpeningChange(ing.ingredient, v)}
                    locked={isLocked}
                />
                <ColumnInput
                    label="Sử dụng"
                    value={usedNum}
                    unit={unit}
                    disabled
                    onLabelClick={hasBreakdown ? toggleExpanded : undefined}
                    labelTrailing={hasBreakdown
                        ? <ChevronDown size={11} className={`text-text-dim shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        : null
                    }
                />
                <ColumnInput
                    label="+ Cuối kỳ"
                    value={inventoryValue ?? ''}
                    unit={unit}
                    disabled={isSubmitting}
                    onChange={(v) => onInventoryChange(ing.ingredient, v)}
                />
            </div>

            {expanded && hasBreakdown && (
                <div className="mt-2 px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 flex flex-col gap-1">
                    {Object.values(breakdown)
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
                    label="Hao hụt"
                    value={haoHut != null ? haoHut : ''}
                    unit={unit}
                    disabled
                    tone={haoHutTone}
                />
                <ColumnInput label="Lý thuyết" value={lyThuyet} unit={unit} disabled />
                <ColumnInput
                    label="Thực tế"
                    value={thucTe != null ? thucTe : ''}
                    unit={unit}
                    disabled
                />
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
        </div>
    )
}

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
                    className={`flex-1 min-w-0 bg-transparent pl-2 py-1.5 text-[13px] font-bold text-right placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 ${inputCls}`}
                />
                <span className={`pr-1.5 text-[10px] font-medium shrink-0 ${unitCls}`}>{unit}</span>
            </div>
        </div>
    )
}

