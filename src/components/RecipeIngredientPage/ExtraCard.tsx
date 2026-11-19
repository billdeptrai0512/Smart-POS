import { useState, useMemo } from 'react'
import type { CartExtra } from '../../types/domain'
import type { ExtraIngRow } from '../../utils/inventory'
import { formatVND, formatSignedVNDInput, parseSignedVNDInput } from '../../utils'
import { getIngredientUnit } from '../../utils/ingredients'
import InlineEditor from './InlineEditor'
import FastIngredientFill, { type CustomIngredient } from './FastIngredientFill'

interface Props {
    extra: CartExtra
    extraIngs: ExtraIngRow[]
    ingredientUnits: Record<string, string>
    dbIngredients: string[]
    canEdit?: boolean
    onSaveName: (name: string) => void
    onSavePrice: (price: number) => void
    onToggleSticky: (sticky: boolean) => void
    onDelete: () => void
    onSaveExtraAmount: (ingredient: string, amount: number) => void
    onDeleteExtraIngredient: (ingredient: string) => void
    onAddExtraIngredients: (ingredient: CustomIngredient) => void
    categoryOf: (ingredient: string) => string | null | undefined
    baseAmounts?: Record<string, number>
}

export default function ExtraCard({
    extra, extraIngs, ingredientUnits, dbIngredients, canEdit,
    onSaveName, onSavePrice, onToggleSticky, onDelete,
    onSaveExtraAmount, onDeleteExtraIngredient, onAddExtraIngredients,
    categoryOf, baseAmounts,
}: Props) {
    const [addingIngredient, setAddingIngredient] = useState(false)

    const unitByKey = useMemo(() => {
        const m: Record<string, string | null | undefined> = {}
        for (const ei of extraIngs) m[ei.ingredient] = ei.unit
        return m
    }, [extraIngs])

    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 max-[329px]:px-2 py-3 flex flex-col gap-2 group">
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
                    allowNegative
                    transform={formatSignedVNDInput}
                    parse={parseSignedVNDInput}
                    renderDisplay={(v) => (
                        <span className={`text-[12px] font-bold tabular-nums ${v < 0 ? 'text-danger' : v > 0 ? 'text-success' : 'text-text-dim'}`}>
                            {v > 0 ? `+${formatVND(v)}` : v < 0 ? `-${formatVND(Math.abs(v))}` : 'Miễn phí'}
                        </span>
                    )}
                />
            </div>

            <div className="border-t border-border/40 pt-2">
                <FastIngredientFill
                    entries={extraIngs}
                    dbIngredients={dbIngredients}
                    getUnit={(k) => getIngredientUnit(k, unitByKey[k], ingredientUnits)}
                    categoryOf={categoryOf}
                    canEdit={canEdit}
                    allowNegative
                    baseAmounts={baseAmounts}
                    addOpen={addingIngredient}
                    onAddOpenChange={setAddingIngredient}
                    onSetAmount={(ing, v) => onSaveExtraAmount(ing, v)}
                    onRemove={(ing) => onDeleteExtraIngredient(ing)}
                    onAddCustom={onAddExtraIngredients}
                />
            </div>

            {/* Phần 3: xóa tùy chọn / thu gọn bảng thêm nguyên liệu — tách riêng bằng 1 đường kẻ dưới danh sách nguyên liệu. */}
            {canEdit && (
                <div className="border-t border-border/40 pt-2 flex flex-col">
                    {addingIngredient ? (
                        <button
                            onClick={() => setAddingIngredient(false)}
                            className="self-end text-[12px] text-text-secondary hover:text-text px-3 py-1 font-medium transition-colors"
                        >
                            Thu gọn
                        </button>
                    ) : (
                        <button
                            onClick={onDelete}
                            className="self-start text-danger hover:bg-danger/10 rounded-full px-3 py-1 text-[11px] font-medium transition-colors"
                            title="Xóa tùy chọn"
                        >
                            Xóa tùy chọn
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
