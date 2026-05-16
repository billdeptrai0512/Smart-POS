import { Lock, Unlock } from 'lucide-react'
import { ingredientLabel } from '../common/recipeUtils'

export default function InventoryReportCard({
    ingredientsList, isLoading,
    openingStock, openingInputs, openingLocked,
    restockInputs, inventoryInputs,
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
                        openingValue={openingInputs[ing.ingredient]}
                        openingFallback={openingStock[ing.ingredient]}
                        isLocked={openingLocked[ing.ingredient]}
                        restockValue={restockInputs[ing.ingredient]}
                        inventoryValue={inventoryInputs[ing.ingredient]}
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
    ing, openingValue, openingFallback, isLocked, restockValue, inventoryValue,
    canUnlock, isSubmitting,
    onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
}) {
    const unit = ing.unit || 'đv'
    const showLockBtn = !isLocked || canUnlock
    const openingDisplay = openingValue ?? (openingFallback !== undefined && openingFallback !== null ? String(openingFallback) : '')

    return (
        <div className="border-b border-border/20 last:border-0 pb-2.5 last:pb-0">
            <span className="text-[12px] font-bold text-text block mb-1.5">{ingredientLabel(ing.ingredient)}</span>

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
                />
                <ColumnInput
                    label="Tồn cuối"
                    value={inventoryValue || ''}
                    unit={unit}
                    disabled={isSubmitting}
                    onChange={(v) => onInventoryChange(ing.ingredient, v)}
                />
            </div>
        </div>
    )
}

function ColumnInput({ label, value, unit, disabled, locked, onChange, headerRight }) {
    const wrapCls = locked
        ? 'bg-primary/8 border border-primary/30'
        : 'bg-surface-light border border-border/60 focus-within:border-primary/40'
    const inputCls = locked ? 'text-primary cursor-not-allowed' : 'text-text'
    const unitCls = locked ? 'text-primary/70' : 'text-text-dim'

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
