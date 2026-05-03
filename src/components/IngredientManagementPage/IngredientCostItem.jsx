import { useRef, useState } from 'react'
import { formatVND } from '../../utils'

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
    packSize, packUnit, minStock, onSaveAdvanced
}) {
    const displayUnit = getIngredientUnit(ingredient, storedUnit)
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
        // Hiệu ứng UX: có thể hiện tick xanh hoặc đóng, nhưng cứ để mở cho thân thiện
    }

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
                        className={`flex-1 min-w-0 text-[15px] font-black text-text leading-tight line-clamp-2 break-words ${canEdit ? 'cursor-pointer hover:text-primary' : ''}`}
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

            {/* Stats group (separated by subtle divider) */}
            <div className="border-t border-border/40 pt-2 flex flex-col gap-1.5 mt-auto">
                {/* Giá row (SECONDARY — key info) */}
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Giá</span>
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
                            <span className="text-[10px] text-text-dim shrink-0">đ</span>
                        </div>
                    ) : (
                        <span
                            className={`text-[14px] font-black text-primary tabular-nums leading-none truncate ${canEdit ? 'cursor-pointer underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary' : ''}`}
                            onClick={() => canEdit && setEditingCost({ ingredient, value: cost.toString() })}
                        >
                            {formatVND(cost)}
                        </span>
                    )}
                </div>

                {/* Đơn vị row (TERTIARY — supporting context) */}
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

                {canEdit && (
                    <div className="border-t border-border/40 pt-1.5 mt-0.5 flex flex-col gap-1.5">
                        {/* Tồn tối thiểu */}
                        <div className="flex items-baseline justify-between gap-2 min-w-0">
                            <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Tồn tối thiểu</span>
                            {isEditingMin ? (
                                <div className="flex items-baseline gap-1 flex-1 min-w-0 justify-end">
                                    <input
                                        type="number"
                                        autoFocus
                                        placeholder="Ngưỡng"
                                        className="w-[55px] bg-primary/10 border border-primary/30 rounded-md px-1.5 py-0.5 text-[12px] font-bold text-primary text-right focus:outline-none focus:border-primary focus:bg-primary/15 transition-all shadow-inner placeholder:text-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        value={advForm.minStock}
                                        onChange={e => setAdvForm(p => ({ ...p, minStock: e.target.value }))}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { handleSaveAdvanced(); setIsEditingMin(false); }
                                            if (e.key === 'Escape') { setAdvForm(p => ({ ...p, minStock: minStock || '' })); setIsEditingMin(false); }
                                        }}
                                        onBlur={() => { handleSaveAdvanced(); setIsEditingMin(false); }}
                                    />
                                    <span className="text-[10px] text-text-dim shrink-0">{displayUnit}</span>
                                </div>
                            ) : (
                                <span
                                    className={`text-[12px] font-bold text-primary leading-none truncate tabular-nums ${canEdit ? 'cursor-pointer underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary' : ''}`}
                                    onClick={() => canEdit && setIsEditingMin(true)}
                                >
                                    {minStock != null ? `${minStock} ${displayUnit}` : '—'}
                                </span>
                            )}
                        </div>

                        {/* Nhập mỗi lần */}
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 min-w-0">
                            <span className="text-[10px] font-bold text-text-dim uppercase tracking-wider shrink-0">Nhập mỗi lần</span>
                            {isEditingPack ? (
                                <div className="flex items-stretch bg-primary/10 border border-primary/30 rounded-md overflow-hidden min-w-0 ml-auto justify-end focus-within:border-primary focus-within:bg-primary/15 focus-within:ring-2 focus-within:ring-primary/20 transition-all shadow-inner">
                                    <input
                                        type="number"
                                        autoFocus
                                        placeholder="Lượng"
                                        className="w-[42px] bg-transparent px-1 py-0.5 text-[12px] font-black text-primary text-center focus:outline-none placeholder:text-primary/40 placeholder:font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        value={advForm.packSize}
                                        onChange={e => setAdvForm(p => ({ ...p, packSize: e.target.value }))}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { handleSaveAdvanced(); setIsEditingPack(false); }
                                            if (e.key === 'Escape') { setAdvForm(p => ({ ...p, packSize: packSize || '', packUnit: packUnit || '' })); setIsEditingPack(false); }
                                        }}
                                        onBlur={() => { handleSaveAdvanced(); setIsEditingPack(false); }}
                                    />
                                    <div className="flex items-center px-1 bg-black/5 dark:bg-white/5 border-x border-primary/20">
                                        <span className="text-[10px] font-bold text-primary/70">{displayUnit}/</span>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="gói"
                                        className="w-[45px] bg-transparent px-1 py-0.5 text-[12px] font-black text-primary text-center focus:outline-none placeholder:text-primary/40 placeholder:font-medium"
                                        value={advForm.packUnit}
                                        onChange={e => setAdvForm(p => ({ ...p, packUnit: e.target.value }))}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { handleSaveAdvanced(); setIsEditingPack(false); }
                                            if (e.key === 'Escape') { setAdvForm(p => ({ ...p, packSize: packSize || '', packUnit: packUnit || '' })); setIsEditingPack(false); }
                                        }}
                                        onBlur={() => { handleSaveAdvanced(); setIsEditingPack(false); }}
                                    />
                                </div>
                            ) : (
                                <span
                                    className={`text-[12px] font-bold text-primary leading-none truncate ${canEdit ? 'cursor-pointer underline decoration-primary/30 underline-offset-[3px] hover:decoration-primary' : ''}`}
                                    onClick={() => canEdit && setIsEditingPack(true)}
                                >
                                    {packSize ? `${packSize}${displayUnit}${packUnit ? ` / ${packUnit}` : ''}` : '—'}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
