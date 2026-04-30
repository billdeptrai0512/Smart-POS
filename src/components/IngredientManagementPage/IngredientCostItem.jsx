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
        <div className="bg-surface border border-border/60 rounded-[14px] p-3 flex flex-col gap-2 min-w-0">
            {/* Name + delete */}
            <div className="flex items-start gap-1.5 min-w-0">
                {isEditingName ? (
                    <input
                        type="text"
                        autoFocus
                        className="flex-1 min-w-0 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13px] font-bold text-text focus:outline-none focus:border-primary"
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
                        className={`flex-1 min-w-0 text-[13px] font-bold text-text leading-tight line-clamp-2 break-words ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
                        onClick={() => canEdit && setEditingName({ ingredient, value: keyToLabel(ingredient) })}
                    >
                        {ingredientLabel(ingredient)}
                    </span>
                )}
                {onDelete && (
                    <button
                        onClick={() => onDelete(ingredient)}
                        className="shrink-0 -mr-1 -mt-1 w-7 h-7 flex items-center justify-center rounded-lg text-danger/50 hover:text-danger active:text-danger active:bg-danger/10 text-[13px] transition-colors"
                        title="Xóa nguyên liệu"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Cost (prominent) */}
            <div className="flex items-baseline gap-1.5 min-w-0 mt-auto">
                <span className="text-[11px] text-text-dim shrink-0">Giá</span>
                {isEditing ? (
                    <div className="flex items-baseline gap-1 flex-1 min-w-0">
                        <input
                            type="number"
                            autoFocus
                            className="flex-1 min-w-0 bg-bg border border-primary/60 rounded-lg px-2 py-0.5 text-[15px] font-black text-primary text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={editingCost.value}
                            onChange={e => setEditingCost(prev => ({ ...prev, value: e.target.value }))}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveCost(ingredient, parseInt(editingCost.value) || 0)
                                if (e.key === 'Escape') setEditingCost(null)
                            }}
                            onBlur={() => saveCost(ingredient, parseInt(editingCost.value) || 0)}
                        />
                        <span className="text-[11px] text-text-dim shrink-0">đ</span>
                    </div>
                ) : (
                    <span
                        className={`flex-1 min-w-0 text-[15px] font-black text-primary tabular-nums leading-tight truncate ${canEdit ? 'cursor-pointer underline decoration-primary/30 underline-offset-2 hover:decoration-primary' : ''}`}
                        onClick={() => canEdit && setEditingCost({ ingredient, value: cost.toString() })}
                    >
                        {formatVND(cost)}
                    </span>
                )}
            </div>

            {/* Unit (smaller, clickable) */}
            <div className="flex items-center gap-1.5 text-[11px] text-text-dim min-w-0">
                <span className="shrink-0">Đơn vị</span>
                {isEditingUnit ? (
                    <input
                        type="text"
                        autoFocus
                        className="flex-1 min-w-0 bg-bg border border-primary/60 rounded px-1.5 py-0.5 text-[11px] font-bold text-primary focus:outline-none focus:border-primary"
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
                        className={`font-bold text-primary truncate ${canEdit ? 'cursor-pointer underline decoration-primary/30 underline-offset-2 hover:decoration-primary' : ''}`}
                        onClick={() => canEdit && setEditingUnit({ ingredient, value: displayUnit })}
                    >
                        {displayUnit}
                    </span>
                )}
            </div>
        </div>
    )
}
