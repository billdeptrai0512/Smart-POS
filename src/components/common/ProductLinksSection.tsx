import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { useProductLinks } from '../../hooks/useProductLinks'
import { groupByDivider } from '../../utils/groupByDivider'

interface Props {
    links: ReturnType<typeof useProductLinks>
    products: { id: string; name: string; is_divider?: boolean | null }[]
    canEdit: boolean
    saving: boolean
    onSave: () => void
}

// Tick-list "Áp dụng cho món" + nút lưu khi có thay đổi. Món chia thành thẻ thu gọn theo các dòng phân nhóm (is_divider) của menu.
export default function ProductLinksSection({ links, products, canEdit, saving, onSave }: Props) {
    // touched[tên nhóm]: người dùng đã mở/đóng/chọn nhóm đó; chưa chạm thì nhóm thu gọn (số n/tổng ở tiêu đề vẫn cho biết đã chọn gì).
    // Khoá theo tên (không theo vị trí) để thêm/bớt nhóm không làm lệch trạng thái của nhóm khác.
    const [touched, setTouched] = useState<Record<string, boolean>>({})
    const grouped = groupByDivider(products)
    const shown = [...grouped.filter(g => g.name), ...grouped.filter(g => !g.name)] // món không thuộc nhóm nào xuống cuối
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
            <div className="space-y-2">
                {shown.map((g, i) => {
                    const key = g.name ?? ''
                    const ids = g.items.map(p => p.id)
                    const n = ids.filter(id => links.selected.has(id)).length
                    const isOpen = !!touched[key]
                    const allOn = n === ids.length
                    return (
                        <div key={key} className="rounded-[12px] border border-border/60 bg-surface overflow-hidden">
                            <div className="flex items-center gap-2 pr-2">
                                <button
                                    type="button"
                                    onClick={() => setTouched(t => ({ ...t, [key]: !isOpen }))}
                                    aria-expanded={isOpen}
                                    className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left"
                                >
                                    <ChevronDown size={14} className={`shrink-0 text-text-secondary transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                                    <span className="truncate text-[12px] font-black uppercase tracking-widest text-text-secondary">{g.name ?? 'Chưa phân loại'}</span>
                                    <span className={`shrink-0 text-[11px] font-bold ${n > 0 ? 'text-primary' : 'text-text-dim'}`}>{n}/{ids.length}</span>
                                </button>
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => { links.setMany(ids, !allOn); setTouched(t => ({ ...t, [key]: true })) }}
                                        className="shrink-0 text-[11px] font-bold text-primary px-2 py-1 rounded-md hover:bg-primary/10 active:bg-primary/20"
                                    >
                                        {allOn ? 'Bỏ cả nhóm' : 'Chọn cả nhóm'}
                                    </button>
                                )}
                            </div>
                            {isOpen && (
                                <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                                    {g.items.map(p => {
                                        const isSelected = links.selected.has(p.id)
                                        return (
                                            <button
                                                key={p.id}
                                                disabled={!canEdit}
                                                onClick={() => { links.toggle(p.id); setTouched(t => ({ ...t, [key]: true })) }}
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
                            )}
                        </div>
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
