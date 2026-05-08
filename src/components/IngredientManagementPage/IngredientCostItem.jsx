import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatVND } from '../../utils'
import { Plus } from 'lucide-react'

export default function IngredientCostItem({
    ingredientLabel, getIngredientUnit, ingredient, cost,
    storedUnit, isEditingUnit, editingUnit, setEditingUnit, saveUnit,
    isEditingName, editingName, setEditingName, saveName,
    canEdit = true,
    minStock,
    // Stock display
    stockData, onRestock,
    isEditingStock, editingStock, setEditingStock, saveStock
}) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)
    const navigate = useNavigate()
    const nameCancelledRef = useRef(false)

    const currentStock = stockData?.current_stock ?? null
    const isLowStock = currentStock !== null && currentStock <= (minStock || 0)

    // Helper: prevent card click khi tương tác với inner control
    const stop = (e) => e.stopPropagation()

    return (
        <div
            className="bg-surface border border-border/60 rounded-[14px] pt-3 px-3 flex flex-col gap-1.5 min-w-0 cursor-pointer hover:bg-surface-light/40 transition-colors"
            onClick={() => navigate(`/ingredients/${ingredient}`)}
        >
            {/* Header: Tên (click → edit) + Nhập kho button */}
            <div className="flex items-start gap-1.5 min-w-0">
                {isEditingName ? (
                    <input
                        type="text"
                        autoFocus
                        onClick={stop}
                        className="flex-1 min-w-0 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13.5px] font-black text-text focus:outline-none focus:border-primary"
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
                        className={`flex-1 min-w-0 text-[13.5px] font-black text-primary leading-tight line-clamp-2 break-words ${canEdit ? 'underline decoration-primary/20 underline-offset-[3px] hover:decoration-primary' : ''}`}
                        onClick={(e) => {
                            if (!canEdit) return
                            e.stopPropagation()
                            setEditingName({ ingredient, value: ingredientLabel(ingredient) })
                        }}
                    >
                        {ingredientLabel(ingredient)}
                    </span>
                )}
                {onRestock && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRestock(ingredient) }}
                        className="shrink-0 -mr-1 -mt-1 w-7 h-7 flex items-center justify-center rounded-lg text-primary bg-primary/10 hover:bg-primary/20 active:scale-95 transition-all"
                        title="Nhập kho"
                    >
                        <Plus size={16} strokeWidth={3} />
                    </button>
                )}
            </div>

            {/* Stock — primary focal info, inline label/value */}
            <div className="border-t border-border/40 pt-3 flex items-baseline justify-between gap-2 min-w-0">
                <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Đơn vị</span>
                <div className="flex items-baseline gap-1 min-w-0">
                    {isEditingUnit ? (
                        <input
                            type="text"
                            autoFocus
                            onClick={stop}
                            className="w-[50px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[12px] font-bold text-primary focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner"
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
                            onClick={(e) => {
                                if (!canEdit) return
                                e.stopPropagation()
                                setEditingUnit({ ingredient, value: displayUnit })
                            }}
                        >
                            {displayUnit}
                        </span>
                    )}
                </div>
            </div>

            {/* Stock — primary focal info, inline label/value */}
            <div className="flex items-baseline justify-between pt-2 pb-1 gap-2 min-w-0">
                <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Tồn kho</span>
                <div className="flex items-baseline gap-0.5 min-w-0">
                    {isEditingStock ? (
                        <input
                            type="number"
                            autoFocus
                            onClick={stop}
                            className="w-[50px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[13px] font-black text-primary text-right focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={editingStock.value}
                            onChange={e => setEditingStock(prev => ({ ...prev, value: e.target.value }))}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveStock(ingredient, editingStock.value, editingStock.original)
                                if (e.key === 'Escape') setEditingStock(null)
                            }}
                            onBlur={() => saveStock(ingredient, editingStock.value, editingStock.original)}
                        />
                    ) : (
                        <>
                            <span
                                className={`text-[13px] font-black tabular-nums leading-none ${isLowStock ? 'text-danger' : 'text-primary'} ${saveStock ? 'cursor-pointer underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary' : ''}`}
                                onClick={(e) => {
                                    if (!saveStock) return
                                    e.stopPropagation()
                                    const v = currentStock !== null ? Math.round(currentStock * 10) / 10 : 0
                                    setEditingStock({ ingredient, value: String(v), original: v })
                                }}
                                title={saveStock ? 'Hiệu chỉnh tồn (kiểm kê / hao hụt)' : undefined}
                            >
                                {currentStock !== null ? Math.round(currentStock * 10) / 10 : '—'}
                            </span>
                            <span
                                className={`text-[12px] font-black tabular-nums leading-none text-text `}
                            >
                                {displayUnit}
                            </span>
                        </>
                    )}

                </div>
            </div>

            {/* Manager-only: Giá vốn (read-only, auto-updated by Weighted Average) */}
            {canEdit && (
                <div className="border-t border-border/40 pt-2 pb-2 flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Giá vốn</span>
                        <span className="text-[13px] font-black text-text tabular-nums leading-none truncate">
                            {formatVND(cost)}
                        </span>
                    </div>
                    {/* <span className="text-[9px] text-text-dim leading-none mt-0.5 text-right">TB tự cập nhật</span> */}
                </div>
            )}

            {/* Action: Nhập kho (đáy card, tách khỏi data zone) */}
            {/* {onRestock && (
                <button
                    onClick={() => onRestock(ingredient)}
                    className="mt-1  w-full flex items-center justify-center gap-1.5 py-2 rounded-[10px] bg-primary/10 border border-primary/20 text-primary text-[12px] font-black uppercase tracking-wide hover:bg-primary/20 active:scale-[0.97] transition-all"
                >
                    <Plus size={14} strokeWidth={3} />
                    Nhập kho
                </button>
            )} */}
        </div>
    )
}
