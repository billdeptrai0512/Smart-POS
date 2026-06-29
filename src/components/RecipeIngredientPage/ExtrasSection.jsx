import { useState } from 'react'
import ExtraCard from './ExtraCard'

export default function ExtrasSection({
    extras, extraIngs, ingredientUnits, dbIngredients, canEdit, saving,
    onAddExtra, onSaveSortOrder,
    extraHandlers, categoryOf,
}) {
    const [addingExtra, setAddingExtra] = useState(false)
    const [newExtraName, setNewExtraName] = useState('')
    const [newExtraPrice, setNewExtraPrice] = useState('')

    const [sorting, setSorting] = useState(false)
    const [sortedExtras, setSortedExtras] = useState([])

    const moveExtra = (from, to) => {
        if (to < 0 || to >= sortedExtras.length) return
        const next = [...sortedExtras]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        setSortedExtras(next)
    }

    const beginSort = () => { setSortedExtras([...extras]); setSorting(true) }
    const commitSort = async () => {
        await onSaveSortOrder(sortedExtras.map(e => e.id))
        setSorting(false)
    }

    const submitAddExtra = () => {
        if (!newExtraName.trim()) return
        onAddExtra(newExtraName.trim(), parseInt(newExtraPrice) || 0)
        setAddingExtra(false)
        setNewExtraName('')
        setNewExtraPrice('')
    }

    return (
        <div className="mt-4 pt-4 border-t border-border/40">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-black text-text uppercase tracking-wide">Tùy chọn thêm</span>
                {canEdit && extras.length > 1 && !sorting && (
                    <button
                        onClick={beginSort}
                        className="text-[11px] text-text-dim hover:text-primary font-bold transition-colors"
                    >
                        Sắp xếp
                    </button>
                )}
            </div>

            {sorting && (
                <SortMode
                    sortedExtras={sortedExtras}
                    onMove={moveExtra}
                    onCancel={() => setSorting(false)}
                    onSave={commitSort}
                    saving={saving}
                />
            )}

            {extras.length === 0 && !addingExtra && (
                <p className="text-text-secondary text-[12px] text-center py-3 bg-surface-light/50 rounded-[12px] border border-border/40">
                    Chưa có tùy chọn nào (ví dụ: Lớn, Trà đá...)
                </p>
            )}

            <div className={`space-y-2 ${sorting ? 'hidden' : ''}`}>
                {extras.map(extra => (
                    <ExtraCard
                        key={extra.id}
                        extra={extra}
                        extraIngs={extraIngs[extra.id] || []}
                        ingredientUnits={ingredientUnits}
                        dbIngredients={dbIngredients}
                        canEdit={canEdit}
                        onSaveName={(v) => extraHandlers.saveName(extra.id, v)}
                        onSavePrice={(v) => extraHandlers.savePrice(extra.id, v)}
                        onToggleSticky={() => extraHandlers.toggleSticky(extra.id, !extra.is_sticky)}
                        onDelete={() => extraHandlers.deleteExtra(extra.id, extra.name)}
                        onSaveExtraAmount={(ing, v) => extraHandlers.saveExtraAmount(extra.id, ing, v)}
                        onDeleteExtraIngredient={(ing) => extraHandlers.deleteExtraIngredient(extra.id, ing)}
                        onAddExtraIngredients={(payload) => extraHandlers.addExtraIngredients(extra.id, payload)}
                        onDuplicate={(name) => extraHandlers.duplicate(extra.id, name)}
                        categoryOf={categoryOf}
                    />
                ))}
            </div>

            {canEdit && !sorting && (addingExtra ? (
                <div className="mt-2 bg-surface border border-border/60 rounded-[14px] px-4 py-3 space-y-2">
                    <span className="text-[11px] text-text-dim font-bold uppercase">Thêm tùy chọn</span>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Tên (VD: Lớn)"
                            autoFocus
                            className="flex-1 min-w-0 bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary"
                            value={newExtraName}
                            onChange={e => setNewExtraName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submitAddExtra() }}
                        />
                        <input
                            type="text"
                            placeholder="Giá"
                            className="w-[80px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={newExtraPrice}
                            onChange={e => setNewExtraPrice(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submitAddExtra() }}
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={submitAddExtra}
                            disabled={!newExtraName.trim()}
                            className="bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50"
                        >
                            Lưu
                        </button>
                        <button
                            onClick={() => { setAddingExtra(false); setNewExtraName(''); setNewExtraPrice('') }}
                            className="bg-surface-light text-text px-2 py-1.5 rounded-lg text-[12px] font-bold"
                        >
                            Hủy
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setAddingExtra(true)}
                    className="w-full text-[12px] text-primary/70 hover:text-primary font-medium mt-2 transition-colors bg-surface border border-border/60 rounded-[14px] px-4 py-3 text-center"
                >
                    + Thêm tùy chọn
                </button>
            ))}
        </div>
    )
}

function SortMode({ sortedExtras, onMove, onCancel, onSave, saving }) {
    return (
        <div className="space-y-1.5 mb-3">
            {sortedExtras.map((extra, index) => (
                <div key={extra.id} className="flex items-center gap-2 bg-surface border border-border/60 rounded-[12px] px-3 py-2">
                    <span className="text-[11px] text-text-dim font-bold w-4 text-right shrink-0">{index + 1}</span>
                    <span className="flex-1 text-[13px] font-bold text-text truncate uppercase">{extra.name}</span>
                    <div className="flex border border-border/80 rounded-[8px] overflow-hidden shrink-0">
                        <button
                            onClick={() => onMove(index, index - 1)} disabled={index === 0}
                            className="px-2.5 py-1 bg-surface-light text-text hover:bg-border/30 disabled:opacity-30 border-r border-border/80 text-[10px] font-bold"
                        >▲</button>
                        <button
                            onClick={() => onMove(index, index + 1)} disabled={index === sortedExtras.length - 1}
                            className="px-2.5 py-1 bg-surface-light text-text hover:bg-border/30 disabled:opacity-30 text-[10px] font-bold"
                        >▼</button>
                    </div>
                </div>
            ))}
            <div className="flex gap-2 mt-2">
                <button onClick={onCancel}
                    className="flex-1 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-[12px] font-bold">Hủy</button>
                <button onClick={onSave} disabled={saving}
                    className="flex-1 py-2 rounded-[10px] bg-primary text-bg text-[12px] font-bold disabled:opacity-50">
                    {saving ? 'Đang lưu...' : 'Lưu thứ tự'}
                </button>
            </div>
        </div>
    )
}
