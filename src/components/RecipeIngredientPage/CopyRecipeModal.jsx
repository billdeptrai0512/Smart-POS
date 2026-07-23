import { X } from 'lucide-react'
import { BottomSheet } from '../common/ModalShell'

// Pick another product to copy its base recipe from. Merges into the current
// product (existing ingredients with the same key get overwritten).
export default function CopyRecipeModal({ products, recipesByProduct, onPick, onClose }) {
    const candidates = products.filter(p => (recipesByProduct.get(p.id)?.length || 0) > 0)

    return (
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-3 animate-slide-up max-h-[80dvh]"
        >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">Chép công thức từ món</span>
                    <button onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                        <X size={16} />
                    </button>
                </div>

                <p className="text-[12px] text-text-secondary">Chọn món có sẵn công thức để chép sang món này.</p>

                <div className="flex flex-col gap-1.5 overflow-y-auto">
                    {candidates.length === 0 && (
                        <p className="text-text-secondary text-[13px] text-center py-6">Chưa có món nào có công thức để chép.</p>
                    )}
                    {candidates.map(p => (
                        <button
                            key={p.id}
                            onClick={() => onPick(p.id, p.name)}
                            className="flex items-center justify-between gap-2 bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-left hover:border-primary/50 active:scale-[0.99] transition-all"
                        >
                            <span className="text-[14px] text-text truncate">{p.name}</span>
                            <span className="text-[11px] text-text-secondary shrink-0">{recipesByProduct.get(p.id).length} nguyên liệu</span>
                        </button>
                    ))}
                </div>
        </BottomSheet>
    )
}
