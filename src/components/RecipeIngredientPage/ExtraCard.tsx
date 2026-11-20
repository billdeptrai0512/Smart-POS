import { useState, useMemo, type ReactNode } from 'react'
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
    /** Tay nắm kéo-thả sắp xếp, đặt bên trái tiêu đề. */
    handle?: ReactNode
}

export default function ExtraCard({
    extra, extraIngs, ingredientUnits, dbIngredients, canEdit,
    onSaveName, onSavePrice, onDelete,
    onSaveExtraAmount, onDeleteExtraIngredient, onAddExtraIngredients,
    categoryOf, baseAmounts, handle,
}: Props) {
    const [addingIngredient, setAddingIngredient] = useState(false)
    const [collapsed, setCollapsed] = useState(true) // vào tab Tùy chọn thêm: mặc định thu gọn hết

    const unitByKey = useMemo(() => {
        const m: Record<string, string | null | undefined> = {}
        for (const ei of extraIngs) m[ei.ingredient] = ei.unit
        return m
    }, [extraIngs])

    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 max-[329px]:px-2 py-2.5 flex flex-col group">
            {/* Bấm cả hàng tiêu đề để thu/mở; tên (sửa), nút xóa, tay nắm kéo chặn nổi bọt nên không kích hoạt thu/mở. */}
            <div className="group/hdr flex items-center gap-2 cursor-pointer" onClick={() => setCollapsed(c => !c)}>
                {/* Thu gọn: tay nắm kéo; mở rộng: nút xóa thế chỗ tay nắm (không kéo-thả khi đang sửa). */}
                {collapsed ? handle : canEdit && (
                    <button
                        onClick={e => { e.stopPropagation(); onDelete() }}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[12px] bg-bg border border-border/60 text-danger group-has-[input:focus]/hdr:hidden active:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                        title="Xóa tùy chọn"
                        aria-label="Xóa tùy chọn"
                    >
                        <X size={16} />
                    </button>
                )}
                <div className="flex-1 flex min-w-0">
                  <div className="min-w-0 max-w-full h-8 flex items-center rounded-[12px] bg-bg border border-border/60 px-3 focus-within:border-primary/60" onClick={e => e.stopPropagation()}>
                    <InlineEditor
                        value={extra.name}
                        canEdit={canEdit}
                        onSave={(v) => onSaveName(v)}
                        type="text"
                        parse={(s) => s.trim()}
                        renderDisplay={(v) => <span className="text-[13px] font-bold text-text uppercase truncate">{v}</span>}
                        displayClassName="text-[13px] font-bold text-text uppercase truncate"
                        inputWidthClassName="w-[14ch] field-sizing-content max-w-full"
                        inputClassName="!border-0 !bg-transparent !px-0 !py-0 !text-left text-[13px] font-bold text-text uppercase"
                    />
                  </div>
                </div>

                {/* Số cộng/trừ vào giá món (chỉ xem; sửa ở hàng GIÁ BÁN khi mở rộng). Chỉ hiện khi thu gọn (mở rộng thì hàng GIÁ BÁN thế chỗ); giá 0 thì ẩn. */}
                {collapsed && extra.price !== 0 && (
                    <span className="shrink-0 h-8 flex items-center rounded-lg bg-bg border border-border/60 overflow-hidden text-[12px] tabular-nums group-has-[input:focus]/hdr:hidden">
                        <span className={`w-7 h-full flex items-center justify-center border-r border-border/60 text-[14px] font-bold ${extra.price < 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>{extra.price < 0 ? '−' : '+'}</span>
                        <span className="px-2 text-text">{formatVND(Math.abs(extra.price))}</span>
                    </span>
                )}

                <button
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

            <Collapse open={!collapsed}>
                <div className="mt-2 border-t border-border/40 pt-2">
                    <PriceRow key={extra.price} price={extra.price} canEdit={canEdit} onSave={onSavePrice} />
                </div>
            </Collapse>

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

// Hàng giá bán: số cộng/trừ vào giá món (như ô nguyên liệu: ± + số). Chọn nhiều tùy chọn thì các số này cộng dồn,
// nên không nhập "giá cuối". Ghi khi blur / Enter / bấm dấu.
function PriceRow({ price, canEdit, onSave }: { price: number; canEdit?: boolean; onSave: (v: number) => void }) {
    const [negative, setNegative] = useState(price < 0)
    const [draft, setDraft] = useState(price ? formatVNDInput(String(Math.abs(price))) : '')
    // Đồng bộ prop→state bằng `key` ở chỗ gọi (giá đổi thì dựng lại), không cần effect.
    const n = parseVNDInput(draft)
    const val = negative ? -n : n
    const commit = (v: number) => { if (v !== price) onSave(v) }

    return (
        <div className="flex items-center justify-between gap-2 px-3 max-[329px]:px-2 py-2 rounded-[12px] bg-surface-light">
            <span className="text-[11px] font-bold uppercase text-text-secondary">Giá bán</span>
            {canEdit ? (
                <SignedBox negative={negative} onToggle={() => { setNegative(!negative); if (n) commit(negative ? n : -n) }} suffix="đ" className="w-[120px] max-[329px]:w-[104px]">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={draft}
                        placeholder="—"
                        aria-label="Giá bán"
                        onChange={e => setDraft(formatVNDInput(e.target.value))}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        onBlur={() => commit(val)}
                        className={SIGNED_INPUT_CLASS}
                    />
                </SignedBox>
            ) : (
                <span className="text-[13px] text-text tabular-nums">{val > 0 ? '+' : val < 0 ? '-' : ''}{formatVND(Math.abs(val))}</span>
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
