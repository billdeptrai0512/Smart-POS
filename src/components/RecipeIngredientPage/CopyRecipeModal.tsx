import { BottomSheet, SheetHeader } from '../common/ModalShell'
import type { Row, UUID } from '../../types/domain'
import type { RecipeRow } from '../../utils/inventory'
import { groupByDivider } from '../../utils/groupByDivider'

interface Props {
    products: Row[]
    recipesByProduct: Map<string, RecipeRow[]>
    onPick: (productId: UUID, name: string) => void
    onClose: () => void
}

// Pick another product to copy its base recipe from. Merges into the current
// product (existing ingredients with the same key get overwritten).
export default function CopyRecipeModal({ products, recipesByProduct, onPick, onClose }: Props) {
    // products giữ nguyên dòng phân nhóm (is_divider) của menu → chia món thành từng nhóm; nhóm không có món nào để chép thì ẩn.
    const shown = groupByDivider(products as (Row & { name: string })[], p => (recipesByProduct.get(p.id)?.length || 0) > 0)

    return (
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-3 animate-slide-up max-h-[80dvh]"
        >
                <SheetHeader title="Chép công thức từ món" onClose={onClose} />

                <p className="text-[12px] text-text-secondary">Chọn món có sẵn công thức để chép sang món này.</p>

                <div className="flex flex-col gap-1.5 overflow-y-auto">
                    {shown.length === 0 && (
                        <p className="text-text-secondary text-[13px] text-center py-6">Chưa có món nào có công thức để chép.</p>
                    )}
                    {shown.map(g => (
                        <div key={g.name ?? ''} className="flex flex-col gap-1.5">
                            {g.name && (
                                <div className="flex items-center gap-3 min-w-0 pt-2">
                                    <span className="flex-1 h-px bg-border" />
                                    <span className="text-[11px] font-black uppercase tracking-widest text-text-secondary truncate max-w-[70%]">{g.name}</span>
                                    <span className="flex-1 h-px bg-border" />
                                </div>
                            )}
                            {g.items.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => onPick(p.id, p.name)}
                                    className="flex items-center justify-between gap-2 bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-left hover:border-primary/50 active:scale-[0.99] transition-all"
                                >
                                    <span className="text-[14px] text-text truncate">{p.name}</span>
                                    <span className="text-[11px] text-text-secondary shrink-0">{recipesByProduct.get(p.id)!.length} nguyên liệu</span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
        </BottomSheet>
    )
}
