import { GripVertical, Plus } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { DndContext, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import type { CartExtra } from '../../types/domain'
import type { ExtraIngredients } from '../../utils/inventory'
import ExtraCard from './ExtraCard'
import { parseSignedVNDInput } from '../../utils'
import SignedMoneyInput from './SignedMoneyInput'
import type { CustomIngredient } from './FastIngredientFill'
import type { ExtraSuggestion } from '../../utils/suggestExtras'
import { getIngredientUnit, ingredientLabel } from '../../utils/ingredients'

export interface BaseItem { ingredient: string; amount: number; unit: string }

export interface ExtraHandlers {
    saveName: (extraId: string, name: string) => void
    savePrice: (extraId: string, price: number) => void
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
    /** items = nguyên liệu chép từ định lượng chính (đúng lượng gốc) vào tùy chọn mới. */
    onAddExtra: (name: string, price: number, items: BaseItem[]) => void
    onSaveSortOrder: (ids: string[]) => Promise<unknown>
    extraHandlers: ExtraHandlers
    categoryOf: (ingredient: string) => string | null | undefined
    baseAmounts?: Record<string, number>
    /** Tùy chọn quán đã dùng ở món khác, đã quy sẵn lượng cho món này — bấm chip là tạo luôn. */
    suggestions?: ExtraSuggestion[]
}

const LABEL = 'text-[11px] font-black uppercase tracking-widest text-text-secondary'

export default function ExtrasSection({
    extras, extraIngs, ingredientUnits, dbIngredients, canEdit,
    onAddExtra, onSaveSortOrder,
    extraHandlers, categoryOf, baseAmounts, suggestions = [],
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

    // Kéo-thả bằng tay nắm ở đầu mỗi card; thả tay là lưu ngay (hiện thứ tự mới trong lúc chờ lưu).
    const [localIds, setLocalIds] = useState<string[] | null>(null)
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    )
    // Thứ tự tạm + các tùy chọn mới thêm / đã xóa trong lúc chờ lưu (đuôi = chưa có trong thứ tự tạm).
    const shown = localIds
        ? [...localIds.map(id => extras.find(e => e.id === id)).filter((e): e is CartExtra => !!e), ...extras.filter(e => !localIds.includes(e.id))]
        : extras
    // Kéo nhanh nhiều lần: lưu tuần tự (lần cuối thắng) và chỉ lần cuối mới bỏ thứ tự tạm — khỏi nhảy lại thứ tự cũ.
    const saveChain = useRef<Promise<unknown>>(Promise.resolve())
    const dragSeq = useRef(0)
    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return
        const ids = shown.map(e => e.id)
        const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
        const seq = ++dragSeq.current
        setLocalIds(next)
        saveChain.current = saveChain.current
            .then(() => onSaveSortOrder(next))
            .catch(() => {})
            .finally(() => { if (dragSeq.current === seq) setLocalIds(null) })
    }

    const submitAddExtra = () => {
        if (!newExtraName.trim()) return
        onAddExtra(newExtraName.trim(), parseSignedVNDInput(newExtraPrice), baseItems.filter(b => picked.has(b.ingredient)))
        closeAddExtra()
    }
    const closeAddExtra = () => { setAddingExtra(false); setNewExtraName(''); setNewExtraPrice(''); setPicked(new Set()) }

    return (
        // Tiêu đề "Tùy chọn thêm" đã là tên tab của trang; FAB thêm nổi ở đáy màn hình; kéo-thả sắp xếp bằng tay nắm ở mỗi card.
        <div className="pb-20">
            {/* Định lượng chính (chỉ đọc) ở đầu trang: để thấy mỗi tùy chọn cộng/trừ gì lên công thức gốc. */}
            {baseItems.length > 0 && (<>
                <div className="space-y-1.5">
                    {baseItems.map(b => (
                        <div key={b.ingredient} className="flex items-center gap-2 max-[329px]:gap-1.5 px-3 max-[329px]:px-2 py-2 rounded-[12px] bg-surface-light">
                            <span className="flex-1 min-w-0 text-[13px] text-text truncate">{ingredientLabel(b.ingredient)}</span>
                            <span className="text-[13px] text-text tabular-nums">{b.amount}</span>
                            <span className="text-[11px] text-text-secondary shrink-0">{b.unit}</span>
                        </div>
                    ))}
                </div>
                <hr className="my-3 border-border/40" />
            </>)}

            {extras.length === 0 && !addingExtra && (
                <p className="text-text-secondary text-[12px] text-center py-3 bg-surface-light/50 rounded-[12px] border border-border/40">
                    Chưa có tùy chọn nào (ví dụ: Lớn, Trà đá...)
                </p>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
                <SortableContext items={shown.map(e => e.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {shown.map(extra => (
                            <SortableRow key={extra.id} id={extra.id} enabled={!!canEdit && extras.length > 1}>
                                {(handle) => (
                                    <ExtraCard
                                        extra={extra}
                                        handle={handle}
                                        extraIngs={extraIngs[extra.id] || []}
                                        ingredientUnits={ingredientUnits}
                                        dbIngredients={dbIngredients}
                                        canEdit={canEdit}
                                        onSaveName={(v) => extraHandlers.saveName(extra.id, v)}
                                        onSavePrice={(v) => extraHandlers.savePrice(extra.id, v)}
                                        onDelete={() => extraHandlers.deleteExtra(extra.id, extra.name)}
                                        onSaveExtraAmount={(ing, v) => extraHandlers.saveExtraAmount(extra.id, ing, v)}
                                        onDeleteExtraIngredient={(ing) => extraHandlers.deleteExtraIngredient(extra.id, ing)}
                                        onAddExtraIngredients={(ingredient) => extraHandlers.addExtraIngredients(extra.id, ingredient)}
                                        categoryOf={categoryOf}
                                        baseAmounts={baseAmounts}
                                    />
                                )}
                            </SortableRow>
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
            {canEdit && addingExtra && (
                <div className="mt-2 bg-surface border border-border/60 rounded-[14px] p-4 flex flex-col gap-4">
                    <span className="text-[13px] font-black text-text uppercase tracking-wide">Thêm tùy chọn</span>
                    <hr className="-mx-4 border-border/40" />

                    {/* Đường nhanh: bấm là tạo luôn, lượng đã quy sẵn cho món này. */}
                    {suggestions.length > 0 && (<>
                        <div className="flex flex-wrap gap-1.5">
                            {suggestions.map(s => (
                                <button
                                    key={s.name}
                                    onClick={() => { onAddExtra(s.name, s.price, s.items); closeAddExtra() }}
                                    className="h-[28px] px-2.5 rounded-[8px] border border-border/80 bg-surface-light text-text-secondary hover:text-primary hover:border-primary/50 font-bold text-[11px] whitespace-nowrap transition-all"
                                >
                                    + {s.name} <span className="text-text-dim font-semibold">· {s.count} món</span>
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-widest text-text-dim">
                            <span className="flex-1 border-t border-border/40" />hoặc tự tạo<span className="flex-1 border-t border-border/40" />
                        </div>
                    </>)}

                    <div className="flex gap-2">
                        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                            <span className={LABEL}>Tên</span>
                            <input
                                type="text"
                                placeholder="Lớn"
                                autoFocus
                                className="w-full h-9 bg-bg border border-border/60 rounded-lg px-3 text-[13px] text-text focus:outline-none focus:border-primary"
                                value={newExtraName}
                                onChange={e => setNewExtraName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitAddExtra() }}
                            />
                        </div>
                        <div className="shrink-0 flex flex-col gap-1.5">
                            <span className={LABEL}>Giá cộng thêm</span>
                            <SignedMoneyInput
                                value={newExtraPrice}
                                onChange={setNewExtraPrice}
                                onKeyDown={e => { if (e.key === 'Enter') submitAddExtra() }}
                            />
                        </div>
                    </div>

                    {baseItems.length > 0 && (
                        <div className="flex flex-col gap-2">
                            <span className={LABEL}>Kèm nguyên liệu · lượng gốc</span>
                            <div className="flex flex-wrap gap-1.5">
                                {baseItems.map(b => {
                                    const on = picked.has(b.ingredient)
                                    return (
                                        <button
                                            key={b.ingredient}
                                            onClick={() => togglePicked(b.ingredient)}
                                            aria-pressed={on}
                                            className={`h-[28px] px-2.5 rounded-[8px] border font-bold text-[11px] whitespace-nowrap transition-all ${on ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                                        >
                                            {on && '✓ '}{ingredientLabel(b.ingredient)} {b.amount} {b.unit}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    <hr className="-mx-4 border-border/40" />
                    <div className="flex gap-2">
                        <button
                            onClick={closeAddExtra}
                            className="flex-1 py-2.5 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-[12px] font-bold"
                        >
                            Hủy
                        </button>
                        <button
                            onClick={submitAddExtra}
                            disabled={!newExtraName.trim()}
                            className="flex-1 py-2.5 rounded-[10px] bg-primary text-bg text-[12px] font-bold disabled:opacity-50"
                        >
                            Lưu
                        </button>
                    </div>
                </div>
            )}

            {/* FAB thêm (phải) — cùng kiểu với /history (chi phí) & /discounts. */}
            {canEdit && !addingExtra && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg lg:max-w-[1280px] mx-auto pointer-events-none z-50">
                    <div className="flex items-center justify-end px-4 lg:px-8 pb-[max(env(safe-area-inset-bottom),16px)] [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),28px)]">
                        <button
                            onClick={() => setAddingExtra(true)}
                            aria-label="Thêm tùy chọn"
                            className="pointer-events-auto bg-primary rounded-[12px] px-4 py-2.5 flex items-center justify-center text-bg hover:bg-primary/90 active:scale-95 transition-all shadow-sm"
                        >
                            <Plus size={18} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function SortableRow({ id, enabled, children }: { id: string; enabled: boolean; children: (handle: ReactNode) => ReactNode }) {
    const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled: !enabled, transition: { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' } })
    // Scale phải nằm trong transform inline của dnd-kit (class Tailwind sẽ bị style đè).
    const lifted = isDragging && transform ? { ...transform, scaleX: 1.02, scaleY: 1.02 } : transform
    const handle = enabled ? (
        <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            aria-label="Kéo để sắp xếp"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[12px] bg-bg border border-border/60 text-text-secondary hover:text-text touch-none cursor-grab active:cursor-grabbing active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
            <GripVertical size={16} />
        </button>
    ) : null
    return (
        <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(lifted), transition }} className={isDragging ? 'relative z-10 rounded-[14px] shadow-xl shadow-black/40 select-none' : ''}>
            {children(handle)}
        </div>
    )
}
