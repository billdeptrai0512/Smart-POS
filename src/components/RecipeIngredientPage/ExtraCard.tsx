import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { CartExtra } from '../../types/domain'
import type { ExtraIngRow } from '../../utils/inventory'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'
import { getIngredientUnit } from '../../utils/ingredients'
import InlineEditor from './InlineEditor'
import { SignedBox, SIGNED_INPUT_CLASS } from './SignedMoneyInput'
import FastIngredientFill, { type CustomIngredient } from './FastIngredientFill'

interface Props {
    extra: CartExtra
    extraIngs: ExtraIngRow[]
    ingredientUnits: Record<string, string>
    dbIngredients: string[]
    canEdit?: boolean
    onSaveName: (name: string) => void
    onSavePrice: (price: number) => void
    onDelete: () => void
    onSaveExtraAmount: (ingredient: string, amount: number) => void
    onDeleteExtraIngredient: (ingredient: string) => void
    onAddExtraIngredients: (ingredient: CustomIngredient) => void
    categoryOf: (ingredient: string) => string | null | undefined
    baseAmounts?: Record<string, number>
    /** Giá bán gốc của món — để hiện tổng "= giá món + tùy chọn". */
    basePrice?: number
}

export default function ExtraCard({
    extra, extraIngs, ingredientUnits, dbIngredients, canEdit,
    onSaveName, onSavePrice, onDelete,
    onSaveExtraAmount, onDeleteExtraIngredient, onAddExtraIngredients,
    categoryOf, baseAmounts, basePrice,
}: Props) {
    const [addingIngredient, setAddingIngredient] = useState(false)
    const [collapsed, setCollapsed] = useState(true) // vào tab Tùy chọn thêm: mặc định thu gọn hết

    const unitByKey = useMemo(() => {
        const m: Record<string, string | null | undefined> = {}
        for (const ei of extraIngs) m[ei.ingredient] = ei.unit
        return m
    }, [extraIngs])

    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 max-[329px]:px-2 py-3 flex flex-col group">
            <div className="flex items-center gap-2">
                <div className="flex-1 flex min-w-0">
                  <div className="min-w-0 max-w-full h-8 flex items-center rounded-[12px] bg-bg border border-border/60 px-3">
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
                </div>

                {canEdit && (
                    <button
                        onClick={onDelete}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[12px] bg-bg border border-border/60 text-danger active:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                        title="Xóa tùy chọn"
                        aria-label="Xóa tùy chọn"
                    >
                        <X size={16} />
                    </button>
                )}
                <button
                    onClick={() => setCollapsed(c => !c)}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[12px] bg-bg border border-border/60 text-text-secondary active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    title={collapsed ? 'Mở rộng' : 'Thu nhỏ'}
                    aria-label={collapsed ? 'Mở rộng' : 'Thu nhỏ'}
                    aria-expanded={!collapsed}
                >
                    <ChevronDown size={16} className={`transition-transform duration-200 ease-out ${collapsed ? '-rotate-90' : ''}`} />
                </button>
            </div>

            <Collapse open={!collapsed}><div className="mt-2 border-t border-border/40 pt-2">
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
            </div></Collapse>

            <div className="mt-2 border-t border-border/40 pt-2">
                <PriceRow price={extra.price} basePrice={basePrice} canEdit={canEdit} onSave={onSavePrice} />
            </div>

            <Collapse open={!collapsed}>
            {canEdit && addingIngredient && (
                <div className="mt-2 border-t border-border/40 pt-2 flex flex-col">
                    <button
                        onClick={() => setAddingIngredient(false)}
                        className="self-end text-[12px] text-text-secondary hover:text-text px-3 py-1 font-medium transition-colors"
                    >
                        Thu gọn
                    </button>
                </div>
            )}
            </Collapse>
        </div>
    )
}

// Hàng giá bán: cùng khuôn với hàng nguyên liệu (nền, ô ± + số, "= tổng"); ghi khi blur / bấm dấu.
function PriceRow({ price, basePrice, canEdit, onSave }: { price: number; basePrice?: number; canEdit?: boolean; onSave: (v: number) => void }) {
    const [negative, setNegative] = useState(price < 0)
    const [draft, setDraft] = useState(price ? formatVNDInput(String(Math.abs(price))) : '')
    // Đồng bộ prop→state khi giá đổi từ nơi khác (như FillRow); chỉ chạy khi `price` đổi.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setNegative(price < 0)
        setDraft(price ? formatVNDInput(String(Math.abs(price))) : '')
    }, [price])

    const n = parseVNDInput(draft)
    const val = negative ? -n : n
    const commit = (v: number) => { if (v !== price) onSave(v) }

    return (
        <div className="flex items-center gap-2 max-[329px]:gap-1.5 px-3 max-[329px]:px-2 py-2 rounded-[12px] bg-surface-light">
            <span className="flex-1 min-w-0 text-[13px] text-text truncate uppercase">Giá bán</span>
            {canEdit ? (
                <SignedBox negative={negative} onToggle={() => { setNegative(!negative); if (n) commit(negative ? n : -n) }} suffix="đ" className="w-[104px] max-[329px]:w-[92px]">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={draft}
                        placeholder="—"
                        onChange={e => setDraft(formatVNDInput(e.target.value))}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        onBlur={() => commit(val)}
                        className={SIGNED_INPUT_CLASS}
                    />
                </SignedBox>
            ) : (
                <span className="text-[13px] text-text tabular-nums">{val > 0 ? '+' : val < 0 ? '-' : ''}{formatVND(Math.abs(val))}</span>
            )}
            {basePrice != null && (
                <span className="shrink-0 text-[11px] text-text-secondary tabular-nums">= <span className="text-[14px] font-black text-success">{formatVND(basePrice + val)}</span></span>
            )}
        </div>
    )
}

// Thu/mở mượt: grid-rows 0fr↔1fr tự theo chiều cao nội dung; inert chặn Tab vào phần đang đóng.
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
    return (
        <div inert={!open} className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
            <div className="min-h-0 overflow-hidden">{children}</div>
        </div>
    )
}
