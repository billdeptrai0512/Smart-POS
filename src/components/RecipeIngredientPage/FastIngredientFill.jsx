import { useState, useEffect, useMemo } from 'react'
import { formatVND } from '../../utils'
import { ingredientLabel } from '../../utils/ingredients'
import IngredientPicker from './IngredientPicker'

const CATS = [
    { key: 'main', label: 'Nguyên liệu chính' },
    { key: 'packaging', label: 'Bao bì' },
]

// Compact fast-fill used by both the base recipe and each extra. Ingredients already
// in use are single-line rows with an amount box; the rest are click chips grouped by
// category — tap to add, then type the quantity. No name-typing in the daily flow.
// Each category has its own "create new" so a brand-new ingredient lands in the right one.
export default function FastIngredientFill({
    entries, dbIngredients, getUnit, categoryOf = () => 'main',
    ingredientCosts, canEdit, showCost = false,
    onSetAmount, onRemove, onAddCustom,
}) {
    const [revealed, setRevealed] = useState(() => new Set()) // chip-tapped, not yet saved
    const [creatingCat, setCreatingCat] = useState(null) // 'main' | 'packaging' while typing a new name
    const [addOpen, setAddOpen] = useState(false) // chip palette hidden until tapped — keeps the screen tidy

    const amountByKey = useMemo(() => {
        const m = {}
        for (const e of entries) m[e.ingredient] = e.amount
        return m
    }, [entries])

    // Rows = saved entries ∪ chip-revealed keys.
    const rowKeys = useMemo(() => {
        const set = new Set(entries.map(e => e.ingredient))
        for (const k of revealed) set.add(k)
        return [...set]
    }, [entries, revealed])

    const reveal = (k) => setRevealed(prev => new Set(prev).add(k))
    const drop = (k) => setRevealed(prev => { const n = new Set(prev); n.delete(k); return n })

    const available = dbIngredients.filter(k => !rowKeys.includes(k))
    const itemsOf = (catKey) => available.filter(k =>
        catKey === 'packaging' ? categoryOf(k) === 'packaging' : categoryOf(k) !== 'packaging')

    return (
        <div className="space-y-2">
            <div className="space-y-1.5">
                {rowKeys.map(k => (
                    <FillRow
                        key={k}
                        ingredient={k}
                        amount={amountByKey[k]}
                        unit={getUnit(k)}
                        unitCost={ingredientCosts?.[k] || 0}
                        canEdit={canEdit}
                        showCost={showCost}
                        autoFocus={revealed.has(k) && !(amountByKey[k] != null)}
                        onCommit={onSetAmount}
                        onRemove={() => { onRemove(k); drop(k) }}
                    />
                ))}
            </div>

            {canEdit && !addOpen && (
                <button onClick={() => setAddOpen(true)}
                    className="text-[12px] border border-dashed border-border/70 text-text-secondary px-2.5 py-1.5 rounded-lg font-medium hover:text-primary hover:border-primary/50 transition-colors">
                    + Thêm nguyên liệu / bao bì
                </button>
            )}

            {canEdit && addOpen && CATS.map(cat => (
                <div key={cat.key} className="space-y-1">
                    <span className="text-[12px] text-text-secondary">{cat.label}</span>
                    <div className="flex flex-wrap gap-1.5">
                        {itemsOf(cat.key).map(k => (
                            <button key={k} onClick={() => reveal(k)}
                                className="text-[12px] border border-primary/20 bg-primary/10 text-primary px-2.5 py-1.5 rounded-lg font-medium hover:bg-primary/20 active:bg-primary/30 transition-colors">
                                + {ingredientLabel(k)}
                            </button>
                        ))}
                        <button onClick={() => setCreatingCat(cat.key)}
                            className="text-[12px] border border-dashed border-border/70 text-text-secondary px-2.5 py-1.5 rounded-lg font-medium hover:text-primary hover:border-primary/50 transition-colors">
                            + Tạo mới
                        </button>
                    </div>
                    {creatingCat === cat.key && (
                        <IngredientPicker
                            availableIngredients={[]}
                            existingIngredients={dbIngredients}
                            label={`Tạo nguyên liệu mới · ${cat.label}`}
                            onConfirm={(payload) => {
                                const custom = payload.custom ? { ...payload.custom, category: cat.key } : undefined
                                onAddCustom({ keys: payload.keys, custom })
                                setCreatingCat(null)
                            }}
                            onCancel={() => setCreatingCat(null)}
                        />
                    )}
                </div>
            ))}

            {canEdit && addOpen && (
                <div className="flex justify-end">
                    <button onClick={() => setAddOpen(false)}
                        className="text-[12px] text-text-secondary px-1 py-0.5 font-medium hover:text-text transition-colors">
                        Thu gọn
                    </button>
                </div>
            )}
        </div>
    )
}

function FillRow({ ingredient, amount, unit, unitCost, canEdit, showCost, autoFocus, onCommit, onRemove }) {
    const [draft, setDraft] = useState(amount != null ? String(amount) : '')
    // Re-sync when the saved amount changes elsewhere (copy-from, context refresh).
    useEffect(() => { setDraft(amount != null ? String(amount) : '') }, [amount])

    const commit = () => {
        const v = parseFloat(draft.replace(',', '.')) || 0 // VN keyboards send "0,5"
        if (v === (amount || 0)) return // unchanged — skip the write
        onCommit(ingredient, v, unit)
    }

    const val = amount || 0

    return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] border bg-surface border-border/60">
            <span className="flex-1 text-[13px] text-text truncate">{ingredientLabel(ingredient)}</span>
            <input
                type="number"
                inputMode="decimal"
                step="any"
                autoFocus={autoFocus}
                value={draft}
                disabled={!canEdit}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                onBlur={commit}
                placeholder="—"
                className="w-[60px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text text-right focus:outline-none focus:border-primary disabled:opacity-60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[11px] text-text-secondary w-6 shrink-0">{unit}</span>
            {showCost && (
                <span className="text-[10px] text-text-dim tabular-nums w-[52px] text-right shrink-0">
                    {val ? formatVND(val * unitCost) : ''}
                </span>
            )}
            {canEdit && (
                <button onClick={onRemove} className="text-danger/60 hover:text-danger text-[13px] shrink-0 w-5 flex items-center justify-center" title="Bỏ khỏi công thức">
                    ✕
                </button>
            )}
        </div>
    )
}
