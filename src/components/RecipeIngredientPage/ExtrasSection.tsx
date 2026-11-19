import { useState } from 'react'
import type { CartExtra } from '../../types/domain'
import type { ExtraIngredients } from '../../utils/inventory'
import ExtraCard from './ExtraCard'
import { parseSignedVNDInput } from '../../utils'
import SignedMoneyInput from './SignedMoneyInput'
import type { CustomIngredient } from './FastIngredientFill'
import { getIngredientUnit, ingredientLabel } from '../../utils/ingredients'

export interface BaseItem { ingredient: string; amount: number; unit: string }

export interface ExtraHandlers {
    saveName: (extraId: string, name: string) => void
    savePrice: (extraId: string, price: number) => void
    toggleSticky: (extraId: string, sticky: boolean) => void
    deleteExtra: (extraId: string, name: string) => void
    saveExtraAmount: (extraId: string, ingredient: string, amount: number) => void
    deleteExtraIngredient: (extraId: string, ingredient: string) => void
    addExtraIngredients: (extraId: string, ingredient: CustomIngredient) => void
}

interface Props {
    extras: CartExtra[]
    extraIngs: ExtraIngredients
    ingredientUnits: Record<string, string>
    dbIngredients: string[]
    canEdit?: boolean
    saving?: boolean
    /** items = nguyên liệu chép từ định lượng chính (đúng lượng gốc) vào tùy chọn mới. */
    onAddExtra: (name: string, price: number, items: BaseItem[]) => void
    onSaveSortOrder: (ids: string[]) => Promise<unknown>
    extraHandlers: ExtraHandlers
    categoryOf: (ingredient: string) => string | null | undefined
    baseAmounts?: Record<string, number>
}

export default function ExtrasSection({
    extras, extraIngs, ingredientUnits, dbIngredients, canEdit, saving,
    onAddExtra, onSaveSortOrder,
    extraHandlers, categoryOf, baseAmounts,
}: Props) {
    const [addingExtra, setAddingExtra] = useState(false)
    const [newExtraName, setNewExtraName] = useState('')
    const [newExtraPrice, setNewExtraPrice] = useState('')
    const [picked, setPicked] = useState<Set<string>>(new Set())
    // Nguyên liệu của định lượng chính: chọn để chép đúng lượng gốc vào tùy chọn mới (rồi sửa lại).
    const baseItems = Object.entries(baseAmounts ?? {})
        .filter(([, a]) => a > 0)
        .map(([ingredient, amount]) => ({ ingredient, amount, unit: getIngredientUnit(ingredient, undefined, ingredientUnits) }))
    const togglePicked = (k: string) => setPicked(prev => { const n = new Set(prev); if (!n.delete(k)) n.add(k); return n })

    const [sorting, setSorting] = useState(false)
    const [sortedExtras, setSortedExtras] = useState<CartExtra[]>([])

    const moveExtra = (from: number, to: number) => {
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
        onAddExtra(newExtraName.trim(), parseSignedVNDInput(newExtraPrice), baseItems.filter(b => picked.has(b.ingredient)))
        closeAddExtra()
    }
    const closeAddExtra = () => { setAddingExtra(false); setNewExtraName(''); setNewExtraPrice(''); setPicked(new Set()) }

    return (
        // Tiêu đề "Tùy chọn thêm" đã là tên tab của trang, nên chỉ còn nút Sắp xếp.
        <div>
            {canEdit && extras.length > 1 && !sorting && (
                <div className="flex justify-end mb-3">
                    <button
                        onClick={beginSort}
                        className="text-[11px] text-text-dim hover:text-primary font-bold transition-colors"
                    >
                        Sắp xếp
                    </button>
                </div>
            )}

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
                        onAddExtraIngredients={(ingredient) => extraHandlers.addExtraIngredients(extra.id, ingredient)}
                        categoryOf={categoryOf}
                        baseAmounts={baseAmounts}
                    />
                ))}
            </div>

            {canEdit && !sorting && (addingExtra ? (
                <div className="mt-2 bg-surface border border-border/60 rounded-[14px] px-4 py-3 space-y-2">
                    <span className="text-[11px] text-text-dim font-bold uppercase">Thêm tùy chọn</span>
                    {/* 3 phần như ExtraCard: tiêu đề / ô nhập / nút — ngăn bằng đường kẻ. */}
                    <div className="flex gap-2 border-t border-border/40 pt-2">
                        <input
                            type="text"
                            placeholder="Lớn"
                            autoFocus
                            className="flex-1 min-w-0 h-9 bg-bg border border-border/60 rounded-lg px-3 text-[13px] text-text focus:outline-none focus:border-primary"
                            value={newExtraName}
                            onChange={e => setNewExtraName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submitAddExtra() }}
                        />
                        <SignedMoneyInput
                            value={newExtraPrice}
                            onChange={setNewExtraPrice}
                            onKeyDown={e => { if (e.key === 'Enter') submitAddExtra() }}
                        />
                    </div>
                    {baseItems.length > 0 && (
                        <div className="border-t border-border/40 pt-2 flex flex-col gap-2">
                            <p className="text-[12px] text-text-secondary">Chép từ định lượng (đúng lượng gốc, sửa lại sau):</p>
                            <div className="flex flex-wrap gap-1.5">
                                {baseItems.map(b => (
                                    <button
                                        key={b.ingredient}
                                        onClick={() => togglePicked(b.ingredient)}
                                        aria-pressed={picked.has(b.ingredient)}
                                        className={`h-[28px] px-2.5 rounded-[8px] border font-bold text-[11px] whitespace-nowrap transition-all ${picked.has(b.ingredient) ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                                    >
                                        {ingredientLabel(b.ingredient)} {b.amount} {b.unit}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="flex justify-between gap-2 border-t border-border/40 pt-2">
                        <button
                            onClick={closeAddExtra}
                            className="bg-surface-light text-text px-3 py-1.5 rounded-lg text-[12px] font-bold"
                        >
                            Hủy
                        </button>
                        <button
                            onClick={submitAddExtra}
                            disabled={!newExtraName.trim()}
                            className="bg-primary text-bg px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50"
                        >
                            Lưu
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

interface SortModeProps {
    sortedExtras: CartExtra[]
    onMove: (from: number, to: number) => void
    onCancel: () => void
    onSave: () => void
    saving?: boolean
}

function SortMode({ sortedExtras, onMove, onCancel, onSave, saving }: SortModeProps) {
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
