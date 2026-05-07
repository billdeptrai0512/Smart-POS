import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatVND } from '../../utils'
import { Plus } from 'lucide-react'

function keyToLabel(key) {
    const name = key.replace(/_/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
}

export default function IngredientCostItem({
    ingredientLabel, getIngredientUnit, ingredient, cost,
    isEditing, editingCost, setEditingCost, saveCost,
    storedUnit, isEditingUnit, editingUnit, setEditingUnit, saveUnit,
    isEditingName, editingName, setEditingName, saveName,
    onDelete, canEdit = true,
    packSize, packUnit, minStock, onSaveAdvanced,
    // New props for stock display
    stockData, todayRestocked, onRestock
}) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)
    const navigate = useNavigate()
    const nameCancelledRef = useRef(false)
    const [isEditingPack, setIsEditingPack] = useState(false)
    const [isEditingMin, setIsEditingMin] = useState(false)
    const [advForm, setAdvForm] = useState({
        packSize: packSize || '',
        packUnit: packUnit || '',
        minStock: minStock || ''
    })

    const handleSaveAdvanced = () => {
        if (!onSaveAdvanced) return;
        onSaveAdvanced(ingredient, {
            packSize: advForm.packSize ? Number(advForm.packSize) : null,
            packUnit: advForm.packUnit ? advForm.packUnit.trim() : null,
            minStock: advForm.minStock ? Number(advForm.minStock) : null
        })
    }

    const currentStock = stockData?.current_stock ?? null
    const restockedToday = todayRestocked ?? stockData?.restocked_qty ?? 0

    return (
        <div className="bg-surface border border-border/60 rounded-[14px] p-3 flex flex-col gap-2.5 min-w-0">
            {/* Name + delete (PRIMARY) */}
            <div className="flex items-start gap-1.5 min-w-0">
                {isEditingName ? (
                    <input
                        type="text"
                        autoFocus
                        className="flex-1 min-w-0 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[15px] font-black text-text focus:outline-none focus:border-primary"
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
                        className={`flex-1 min-w-0 text-[15px] font-black text-text leading-tight line-clamp-2 break-words cursor-pointer hover:text-primary`}
                        onClick={() => navigate(`/ingredients/${ingredient}`)}
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

            {/* Stock info (visible to all) */}
            <div className="border-t border-border/40 pt-2 flex flex-col gap-1.5">
                {/* Tồn kho hiện tại */}
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Tồn kho</span>
                    <span className={`text-[14px] font-black tabular-nums leading-none ${currentStock !== null && currentStock <= (minStock || 0) ? 'text-danger' : 'text-text'}`}>
                        {currentStock !== null ? `${Math.round(currentStock * 10) / 10} ${displayUnit}` : '—'}
                    </span>
                </div>

                {/* Đơn vị */}
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Đơn vị</span>
                    {isEditingUnit ? (
                        <input
                            type="text"
                            autoFocus
                            className="w-[50px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[12px] font-bold text-primary text-right focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner"
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
                            className={`text-[12px] font-bold text-primary leading-none truncate ${canEdit ? 'cursor-pointer underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary' : ''}`}
                            onClick={() => canEdit && setEditingUnit({ ingredient, value: displayUnit })}
                        >
                            {displayUnit}
                        </span>
                    )}
                </div>

                {/* Nút Nhập kho */}
                {onRestock && (
                    <button
                        onClick={() => onRestock(ingredient)}
                        className="mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded-[10px] bg-primary/10 border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wide hover:bg-primary/20 active:scale-[0.97] transition-all"
                    >
                        <Plus size={14} strokeWidth={3} />
                        Nhập kho
                    </button>
                )}
            </div>

            {/* Manager-only section: Giá vốn + Config */}
            {canEdit && (
                <div className="border-t border-border/40 pt-2 flex flex-col gap-1.5">
                    {/* Giá vốn */}
                    <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Giá vốn</span>
                        {isEditing ? (
                            <div className="flex items-baseline gap-1 flex-1 min-w-0 justify-end">
                                <input
                                    type="number"
                                    autoFocus
                                    className="w-[65px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[14px] font-black text-primary text-right focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={editingCost.value}
                                    onChange={e => setEditingCost(prev => ({ ...prev, value: e.target.value }))}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') saveCost(ingredient, parseInt(editingCost.value) || 0)
                                        if (e.key === 'Escape') setEditingCost(null)
                                    }}
                                    onBlur={() => saveCost(ingredient, parseInt(editingCost.value) || 0)}
                                />
                                <span className="text-[10px] text-text-dim shrink-0">đ/{displayUnit}</span>
                            </div>
                        ) : (
                            <span
                                className="text-[14px] font-black text-primary tabular-nums leading-none truncate cursor-pointer underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary"
                                onClick={() => setEditingCost({ ingredient, value: cost.toString() })}
                            >
                                {formatVND(cost)}/{displayUnit}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
