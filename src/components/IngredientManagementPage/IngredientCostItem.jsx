import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatVND } from '../../utils'
import { Plus } from 'lucide-react'

/**
 * Compact 2-line ingredient card:
 *   ┌──────────────────────────┐
 *   │ Cà phê             [+]   │  ← name + restock button
 *   │ 9180 g                   │  ← hero number (large, color-coded for low stock)
 *   │ 248đ/g · 1 bịch=1000g    │  ← meta line (manager only): unit cost + pack config
 *   └──────────────────────────┘
 *
 * Click handlers (all stopPropagation to prevent card-level navigate):
 *   - name → rename
 *   - hero number → edit stock
 *   - unit suffix → edit unit
 *   - meta pack span → open PackConfigModal
 *   - [+] → onRestock
 *   - card body (outside above) → navigate to /ingredients/[key] detail
 */
export default function IngredientCostItem({
    ingredientLabel, getIngredientUnit, ingredient, cost,
    storedUnit, isEditingUnit, editingUnit, setEditingUnit, saveUnit,
    isEditingName, editingName, setEditingName, saveName,
    canEdit = true,
    minStock,
    // Pack config (quy cách đóng gói)
    packSize, packUnit, onConfigurePack,
    // Stock display
    stockData, onRestock,
    isEditingStock, editingStock, setEditingStock, saveStock
}) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)
    const navigate = useNavigate()
    const nameCancelledRef = useRef(false)

    const currentStock = stockData?.current_stock ?? null
    const isLowStock = currentStock !== null && currentStock <= (minStock || 0)
    const hasPack = !!(packSize && packUnit)

    const stop = (e) => e.stopPropagation()

    return (
        <div
            className={`bg-surface border rounded-[14px] p-3 flex flex-col gap-2 min-w-0 cursor-pointer hover:bg-surface-light/40 transition-colors ${isLowStock ? 'border-danger/40' : 'border-border/60'}`}
            onClick={() => navigate(`/ingredients/${ingredient}`)}
        >
            {/* Row 1: name + restock button */}
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

            {/* Row 2: hero — tồn kho number + unit */}
            <div className="flex items-baseline gap-1 min-w-0 -mt-0.5">
                {isEditingStock ? (
                    <input
                        type="number"
                        autoFocus
                        onClick={stop}
                        className="w-[70px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[17px] font-black text-primary focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editingStock.value}
                        onChange={e => setEditingStock(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') saveStock(ingredient, editingStock.value, editingStock.original)
                            if (e.key === 'Escape') setEditingStock(null)
                        }}
                        onBlur={() => saveStock(ingredient, editingStock.value, editingStock.original)}
                    />
                ) : (
                    <span
                        className={`text-[17px] font-black tabular-nums leading-none ${isLowStock ? 'text-danger' : 'text-text'} ${saveStock ? 'cursor-pointer' : ''}`}
                        onClick={(e) => {
                            if (!saveStock) return
                            e.stopPropagation()
                            const v = currentStock !== null ? Math.round(currentStock * 10) / 10 : 0
                            setEditingStock({ ingredient, value: String(v), original: v })
                        }}
                        title={saveStock ? 'Hiệu chỉnh tồn' : undefined}
                    >
                        {currentStock !== null ? Math.round(currentStock * 10) / 10 : '—'}
                    </span>
                )}
                {isEditingUnit ? (
                    <input
                        type="text"
                        autoFocus
                        onClick={stop}
                        className="w-[40px] bg-primary/10 border border-primary/30 rounded-md px-1 py-0.5 text-[13px] font-bold text-primary focus:outline-none focus:border-primary focus:bg-primary/15 transition-all"
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
                        className={`text-[13px] font-bold text-text-secondary leading-none ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
                        onClick={(e) => {
                            if (!canEdit) return
                            e.stopPropagation()
                            setEditingUnit({ ingredient, value: displayUnit })
                        }}
                        title={canEdit ? 'Sửa đơn vị' : undefined}
                    >
                        {displayUnit}
                    </span>
                )}
                {isLowStock && (
                    <span className="ml-auto text-[10px] font-black text-danger uppercase tracking-wide">Sắp hết</span>
                )}
            </div>

            {/* Row 3: meta line — manager only */}
            {canEdit && (
                <div className="flex flex-col gap-0.5 -mt-1">
                    <div className="flex items-center text-[11px] min-w-0">
                        <span className="text-text-secondary font-bold tabular-nums shrink-0">
                            {formatVND(cost)}<span className="text-text-dim font-medium">/{displayUnit}</span>
                        </span>
                    </div>
                    {onConfigurePack && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onConfigurePack(ingredient) }}
                            className="text-left text-[11px] font-bold tabular-nums hover:text-primary transition-colors w-fit"
                            title={hasPack ? 'Sửa quy cách đóng gói' : 'Thêm quy cách đóng gói'}
                        >
                            {hasPack ? (
                                <span className="text-text-secondary">
                                    1 {packUnit} = {packSize} {displayUnit}
                                </span>
                            ) : (
                                <span className="text-text-dim italic font-medium">+ quy cách</span>
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
