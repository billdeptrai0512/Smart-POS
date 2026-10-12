import type { useProductLinks } from '../../hooks/useProductLinks'

interface Props {
    links: ReturnType<typeof useProductLinks>
    products: { id: string; name: string; is_divider?: boolean | null }[]
    canEdit: boolean
    saving: boolean
    onSave: () => void
}

// Tick-list "Áp dụng cho món" + nút lưu khi có thay đổi.
export default function ProductLinksSection({ links, products, canEdit, saving, onSave }: Props) {
    return (
        <section className="pt-4 border-t border-border/40">
            <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-black text-text uppercase tracking-wide">Áp dụng cho món</span>
                {links.selected.size > 0 && (
                    <span className="text-[10px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                        Đã chọn {links.selected.size}
                    </span>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {products.filter(p => !p.is_divider).map(p => {
                    const isSelected = links.selected.has(p.id)
                    return (
                        <button
                            key={p.id}
                            disabled={!canEdit}
                            onClick={() => links.toggle(p.id)}
                            className={`text-[12px] border px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60 ${isSelected
                                ? 'bg-primary text-bg border-primary shadow-sm'
                                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 active:bg-primary/30'
                                }`}
                        >
                            {isSelected ? '✓ ' : '+ '}{p.name}
                        </button>
                    )
                })}
            </div>
            {canEdit && links.dirty && (
                <button
                    onClick={onSave}
                    disabled={saving}
                    className="w-full mt-3 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                >
                    Lưu danh sách món
                </button>
            )}
        </section>
    )
}
