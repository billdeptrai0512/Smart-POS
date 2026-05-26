import { useState } from 'react'
import { formatVND } from '../../utils'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import InlineEditor from './InlineEditor'
import IngredientPicker from './IngredientPicker'

export default function ExtraCard({
    extra, extraIngs, ingredientUnits, dbIngredients, canEdit,
    onSaveName, onSavePrice, onToggleSticky, onDelete,
    onSaveExtraAmount, onDeleteExtraIngredient, onAddExtraIngredients, onDuplicate,
    ingredientStocks,
}) {
    const [addingIngs, setAddingIngs] = useState(false)
    const [duplicating, setDuplicating] = useState(false)
    const [duplicateName, setDuplicateName] = useState('')

    const existing = extraIngs.map(ei => ei.ingredient)
    const available = dbIngredients.filter(i => !existing.includes(i))

    const submitDuplicate = () => {
        if (!duplicateName.trim()) return
        onDuplicate(duplicateName.trim())
        setDuplicating(false)
        setDuplicateName('')
    }

    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex flex-col gap-2 group">
            <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-1 min-w-0">
                    {canEdit && (
                        <button
                            onClick={() => onToggleSticky(!extra.is_sticky)}
                            className={`shrink-0 w-6 h-6 flex items-center text-[13px] justify-center rounded transition-colors ${extra.is_sticky ? 'text-warning' : 'text-text-dim/40 hover:text-text-dim'}`}
                            title={extra.is_sticky ? 'Đang tự chọn — bấm để tắt' : 'Bấm để bật tự chọn'}
                        >
                            {extra.is_sticky ? '🔒' : '🔓'}
                        </button>
                    )}
                    <InlineEditor
                        value={extra.name}
                        canEdit={canEdit}
                        onSave={(v) => onSaveName(v)}
                        type="text"
                        parse={(s) => s.trim()}
                        renderDisplay={(v) => <span className="text-[13px] font-bold text-text uppercase truncate">{v}</span>}
                        displayClassName="text-[13px] font-bold text-text uppercase truncate"
                        inputWidthClassName="flex-1"
                        inputClassName="text-[13px] font-bold text-text uppercase"
                    />
                </div>

                <InlineEditor
                    value={extra.price}
                    canEdit={canEdit}
                    onSave={onSavePrice}
                    type="number"
                    suffix="đ"
                    inputWidthClassName="w-[80px]"
                    renderDisplay={(v) => (
                        <span className={`text-[12px] font-bold tabular-nums ${v < 0 ? 'text-danger' : v > 0 ? 'text-success' : 'text-text-dim'}`}>
                            {v > 0 ? `+${formatVND(v)}` : v < 0 ? `-${formatVND(Math.abs(v))}` : 'Miễn phí'}
                        </span>
                    )}
                />

                {canEdit && (
                    <button
                        onClick={onDelete}
                        className="text-danger hover:text-danger text-[14px] shrink-0 w-6 h-6 flex items-center justify-center"
                        title="Xóa tùy chọn"
                    >
                        ✕
                    </button>
                )}
            </div>

            <div className="border-t border-border/40 pt-2 flex flex-col gap-1.5">
                {extraIngs.map(ei => (
                    <ExtraIngredientRow
                        key={ei.id ?? ei.ingredient}
                        ei={ei}
                        unit={getIngredientUnit(ei.ingredient, ei.unit, ingredientUnits)}
                        currentStock={ingredientStocks?.[ei.ingredient]}
                        canEdit={canEdit}
                        onSaveAmount={(v) => onSaveExtraAmount(ei.ingredient, v)}
                        onDelete={() => onDeleteExtraIngredient(ei.ingredient)}
                    />
                ))}

                {canEdit && addingIngs && (
                    <IngredientPicker
                        availableIngredients={available}
                        existingIngredients={dbIngredients}
                        label="Thêm nguyên liệu / tác động"
                        onConfirm={(payload) => {
                            onAddExtraIngredients(payload)
                            setAddingIngs(false)
                        }}
                        onCancel={() => setAddingIngs(false)}
                    />
                )}

                {canEdit && duplicating && (
                    <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-border/30">
                        <div className="flex flex-wrap sm:flex-nowrap gap-1.5">
                            <input
                                type="text"
                                autoFocus
                                placeholder="Tên..."
                                value={duplicateName}
                                onChange={e => setDuplicateName(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') submitDuplicate()
                                    if (e.key === 'Escape') setDuplicating(false)
                                }}
                                className="flex-1 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[12px] text-text focus:outline-none focus:border-primary"
                            />
                            <div className="flex gap-2 mt-1">
                                <button
                                    onClick={submitDuplicate}
                                    className="flex-1 bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 transition-opacity"
                                >
                                    Nhân bản
                                </button>
                                <button
                                    onClick={() => { setDuplicating(false); setDuplicateName('') }}
                                    className="shrink-0 bg-surface-light border border-border/60 text-text px-2 py-1.5 rounded-lg text-[12px] font-bold"
                                >
                                    Hủy
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {canEdit && !addingIngs && !duplicating && (
                    <div className="flex justify-between gap-2 mt-1">
                        <button
                            onClick={() => setAddingIngs(true)}
                            className="text-[11px] text-primary hover:underline self-start font-medium mt-1"
                        >
                            + Thêm nguyên liệu
                        </button>
                        <button
                            onClick={() => setDuplicating(true)}
                            className="text-text-dim hover:text-primary text-[14px] shrink-0 w-6 h-6 flex items-center justify-center"
                            title="Nhân bản"
                        >
                            ⧉
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

function ExtraIngredientRow({ ei, unit, currentStock, canEdit, onSaveAmount, onDelete }) {
    return (
        <div className="flex justify-between items-center bg-bg/50 px-2 py-1.5 rounded text-[12px]">
            <div className="flex flex-col flex-1 min-w-0">
                <span className="text-text truncate">{ingredientLabel(ei.ingredient)}</span>
                <span className="text-[10px] text-text-secondary mt-0.5">Tồn: {currentStock != null ? `${Math.round(currentStock * 10) / 10} ${unit}` : '—'}</span>
            </div>
            <div className="flex items-center gap-2">
                <InlineEditor
                    value={ei.amount}
                    canEdit={canEdit}
                    onSave={onSaveAmount}
                    type="number"
                    step="any"
                    suffix={unit}
                    inputWidthClassName="w-[60px]"
                    renderDisplay={(v) => (
                        <span className={`font-bold tabular-nums min-w-[32px] text-right ${v > 0 ? 'text-primary' : v < 0 ? 'text-danger' : 'text-text-dim'}`}>
                            {v > 0 ? '+' : ''}{v} <span className="text-[10px] font-normal text-text-dim/70">{unit}</span>
                        </span>
                    )}
                />
                {canEdit && <button onClick={onDelete} className="text-danger/60 hover:text-danger text-[14px]">✕</button>}
            </div>
        </div>
    )
}
