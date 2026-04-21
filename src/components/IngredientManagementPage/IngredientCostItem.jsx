import { useRef } from 'react'
import { formatVND } from '../../utils'

function keyToLabel(key) {
    const name = key.replace(/_/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
}

export default function IngredientCostItem({ ingredientLabel, getIngredientUnit, ingredient, cost, isEditing, editingCost, setEditingCost, saveCost, storedUnit, isEditingUnit, editingUnit, setEditingUnit, saveUnit, isEditingName, editingName, setEditingName, saveName, onDelete, canEdit = true }) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)
    const nameCancelledRef = useRef(false)

    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex flex-col flex-1 min-w-0">
                {isEditingName ? (
                    <input
                        type="text"
                        autoFocus
                        className="bg-bg border border-primary/60 rounded-lg px-2 py-0.5 text-[14px] font-bold text-text focus:outline-none focus:border-primary w-full"
                        value={editingName.value}
                        onChange={e => setEditingName(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { nameCancelledRef.current = false; saveName(ingredient, editingName.value) }
                            if (e.key === 'Escape') { nameCancelledRef.current = true; setEditingName(null) }
                        }}
                        onBlur={() => {
                            if (nameCancelledRef.current) { nameCancelledRef.current = false; return }
                            saveName(ingredient, editingName.value)
                        }}
                    />
                ) : (
                    <span
                        className={`text-[14px] font-bold text-text truncate ${canEdit ? 'cursor-pointer hover:text-primary hover:underline' : ''}`}
                        onClick={() => canEdit && setEditingName({ ingredient, value: keyToLabel(ingredient) })}
                    >
                        {ingredientLabel(ingredient)}
                    </span>
                )}
                <div className="flex items-center gap-1 text-[11px] text-text-dim mt-0.5">
                    <span>Đơn vị:</span>
                    {isEditingUnit ? (
                        <input
                            type="text"
                            autoFocus
                            className="w-[52px] bg-bg border border-primary/60 rounded px-1.5 py-0.5 text-[11px] text-primary focus:outline-none focus:border-primary"
                            value={editingUnit.value}
                            onChange={e => setEditingUnit(prev => ({ ...prev, value: e.target.value }))}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveUnit(ingredient, editingUnit.value.trim() || 'đv', cost)
                                if (e.key === 'Escape') setEditingUnit(null)
                            }}
                            onBlur={() => saveUnit(ingredient, editingUnit.value.trim() || 'đv', cost)}
                        />
                    ) : (
                        <span
                            className={`font-medium text-primary ${canEdit ? 'cursor-pointer hover:text-primary hover:underline' : ''}`}
                            onClick={() => canEdit && setEditingUnit({ ingredient, value: displayUnit })}
                        >
                            {displayUnit}
                        </span>
                    )}
                </div>
            </div>

            {isEditing ? (
                <div className="flex items-center gap-1.5 shrink-0">
                    <input
                        type="number"
                        autoFocus
                        className="w-[90px] bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[14px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editingCost.value}
                        onChange={e => setEditingCost(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') saveCost(ingredient, parseInt(editingCost.value) || 0)
                            if (e.key === 'Escape') setEditingCost(null)
                        }}
                        onBlur={() => saveCost(ingredient, parseInt(editingCost.value) || 0)}
                    />
                    <span className="text-[12px] text-text-dim">đ / {displayUnit}</span>
                </div>
            ) : (
                <span
                    className={`text-[14px] font-bold text-primary tabular-nums shrink-0 ${canEdit ? 'cursor-pointer hover:underline' : ''}`}
                    onClick={() => canEdit && setEditingCost({ ingredient, value: cost.toString() })}
                >
                    {formatVND(cost)}<span className="text-[12px] font-normal text-text-dim ml-0.5">/ {displayUnit}</span>
                </span>
            )}

            {onDelete && (
                <button
                    onClick={() => onDelete(ingredient)}
                    className="text-danger/50 hover:text-danger active:text-danger text-[14px] shrink-0 w-7 h-7 flex items-center justify-center rounded-lg active:bg-danger/10 transition-colors"
                    title="Xóa nguyên liệu"
                >
                    ✕
                </button>
            )}
        </div>
    )
}
