import { Lock, Unlock, AlertTriangle } from 'lucide-react'
import { ingredientLabel, getIngredientUnit } from '../common/recipeUtils'
import { formatPackedQty } from '../../utils/inventory'

export default function InventoryReportCard({
    ingredientsList, isLoading,
    openingStock, openingInputs, openingLocked,
    restockInputs, inventoryInputs,
    warehouseStocks = {},
    ingredientUnits = {},
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

function IngredientRow({
    ing, ingredientUnits, openingValue, openingFallback, isLocked, restockValue, inventoryValue,
    warehouseAvailable,
    canUnlock, isSubmitting,
    onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
}) {
    // Match /ingredients unit resolution: prefer DB unit, fall back to ingredient_costs
    // map, then suffix inference (_g→g, _ml→ml). Avoids the "đv" fallback when the
    // address-specific cost row has a null unit override.
    const unit = getIngredientUnit(ing.ingredient, ing.unit, ingredientUnits)
    const showLockBtn = !isLocked || canUnlock
    const packSize = Number(ing.pack_size || 0)
    const packUnit = ing.pack_unit
    const fmt = (n) => formatPackedQty(n, packSize, packUnit, unit, { compact: true })
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')

    // Over-report detection: if staff types restock > kho tổng available, the difference
    // becomes a phantom deficit that absorbs future NHẬP KHO. Surface it inline.
    const restockNum = Number(restockValue || 0)
    const warehouseNum = Number(warehouseAvailable || 0)
    const restockOverflow = warehouseAvailable !== undefined && restockNum > warehouseNum
    const overBy = restockOverflow ? restockNum - warehouseNum : 0

    // Live computed end-of-shift balances.
    const warehouseEnd = Math.max(0, warehouseNum - restockNum)
    const counterEnd = Number(inventoryValue || 0)
    const showTotals = warehouseAvailable !== undefined && (restockValue !== undefined || inventoryValue !== undefined)

    return (
        <div className="border-b border-border/20 last:border-0 pb-2.5 last:pb-0">
            <div className="flex items-baseline justify-between mb-1.5 gap-2">
                <span className="text-[12px] font-bold text-text">{ingredientLabel(ing.ingredient)}</span>

            </div>

            <div className="grid grid-cols-3 gap-2">
                <ColumnInput
                    label="Tồn đầu"
                    value={openingDisplay}
                    unit={unit}
                    disabled={isLocked || isSubmitting}
                    onChange={(v) => onOpeningChange(ing.ingredient, v)}
                    locked={isLocked}
                    headerRight={showLockBtn && (
                        <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => onOpeningLock(ing.ingredient, !isLocked)}
                            className={`transition-colors disabled:opacity-50 ${isLocked ? 'text-primary' : 'text-text-dim hover:text-primary'}`}
                        >
                            {isLocked ? <Lock size={10} strokeWidth={2.5} /> : <Unlock size={10} strokeWidth={2} />}
                        </button>
                    )}
                />
                <ColumnInput
                    label="Nhập thêm"
                    value={restockValue || ''}
                    unit={unit}
                    disabled={isSubmitting}
                    onChange={(v) => onRestockChange(ing.ingredient, v)}
                    overflow={restockOverflow}
                />
                <ColumnInput
                    label="Tồn cuối"
                    value={inventoryValue || ''}
                    unit={unit}
                    disabled={isSubmitting}
                    onChange={(v) => onInventoryChange(ing.ingredient, v)}
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

            {showTotals && !restockOverflow && (
                <div className="flex items-baseline justify-between mt-1.5 text-[10px] tabular-nums leading-tight gap-2">
                    {warehouseAvailable !== undefined && (
                        <span className="text-[9px] font-bold text-text-dim uppercase tabular-nums text-right">
                            Tôn kho: <span className="text-text-secondary">{fmt(warehouseNum)}</span>
                        </span>
                    )}
                    <span className="text-[9px] font-bold text-text-dim uppercase tabular-nums text-right">
                        cuối ngày: <span className="text-text-secondary font-bold">{fmt(warehouseEnd + counterEnd)}</span>
                    </span>
                </div>
            )}
        </div>
    )
}

function ColumnInput({ label, value, unit, disabled, locked, onChange, headerRight, overflow }) {
    const wrapCls = overflow
        ? 'bg-danger/5 border border-danger/40 focus-within:border-danger'
        : locked
            ? 'bg-primary/8 border border-primary/30'
            : 'bg-surface-light border border-border/60 focus-within:border-primary/40'
    const inputCls = overflow ? 'text-danger' : locked ? 'text-primary cursor-not-allowed' : 'text-text'
    const unitCls = overflow ? 'text-danger/70' : locked ? 'text-primary/70' : 'text-text-dim'

    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-black text-text-dim uppercase">{label}</span>
                {headerRight}
            </div>
            <div className={`flex items-center rounded-[10px] overflow-hidden transition-all gap-1 ${wrapCls}`}>
                <input
                    type="number"
                    placeholder="-"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    disabled={disabled}
                    className={`flex-1 min-w-0 bg-transparent pl-2 py-1.5 text-[13px] font-bold text-right placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50 ${inputCls}`}
                />
                <span className={`pr-1.5 text-[10px] font-medium shrink-0 ${unitCls}`}>{unit}</span>
            </div>
        </div>
    )
}
