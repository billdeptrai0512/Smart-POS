import { useState, useMemo } from 'react'
import { formatVND } from '../../utils'
import { getIngredientUnit } from '../../utils/ingredients'
import InlineEditor from './InlineEditor'
import FastIngredientFill from './FastIngredientFill'

export default function ExtraCard({
    extra, extraIngs, ingredientUnits, dbIngredients, canEdit,
    onSaveName, onSavePrice, onToggleSticky, onDelete,
    onSaveExtraAmount, onDeleteExtraIngredient, onAddExtraIngredients, onDuplicate,
    categoryOf,
}) {
    const [duplicating, setDuplicating] = useState(false)
    const [duplicateName, setDuplicateName] = useState('')

    const unitByKey = useMemo(() => {
        const m = {}
        for (const ei of extraIngs) m[ei.ingredient] = ei.unit
        return m
    }, [extraIngs])

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
                    allowNegative
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

            <div className="border-t border-border/40 pt-2 flex flex-col gap-2">
                <FastIngredientFill
                    entries={extraIngs}
                    dbIngredients={dbIngredients}
                    getUnit={(k) => getIngredientUnit(k, unitByKey[k], ingredientUnits)}
                    categoryOf={categoryOf}
                    canEdit={canEdit}
                    onSetAmount={(ing, v) => onSaveExtraAmount(ing, v)}
                    onRemove={(ing) => onDeleteExtraIngredient(ing)}
                    onAddCustom={onAddExtraIngredients}
                />

                {canEdit && (duplicating ? (
                    <div className="flex gap-1.5 pt-2 border-t border-border/30">
                        <input
                            type="text"
                            autoFocus
                            placeholder="Tên tùy chọn mới…"
                            value={duplicateName}
                            onChange={e => setDuplicateName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') submitDuplicate()
                                if (e.key === 'Escape') setDuplicating(false)
                            }}
                            className="flex-1 min-w-0 bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[12px] text-text focus:outline-none focus:border-primary"
                        />
                        <button onClick={submitDuplicate} className="bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold">Tạo</button>
                        <button onClick={() => { setDuplicating(false); setDuplicateName('') }} className="shrink-0 bg-surface-light border border-border/60 text-text px-2 py-1.5 rounded-lg text-[12px] font-bold">Hủy</button>
                    </div>
                ) : (
                    <button
                        onClick={() => setDuplicating(true)}
                        className="text-text-dim hover:text-primary text-[11px] font-medium self-end"
                        title="Tạo một tùy chọn giống hệt cái này để chỉnh"
                    >
                        ⧉ Tạo bản giống
                    </button>
                ))}
            </div>
        </div>
    )
}
