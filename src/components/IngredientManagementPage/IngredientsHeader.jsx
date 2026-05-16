import { ArrowLeft } from 'lucide-react'

export default function IngredientsHeader({ count, isSorting, onBack }) {
    const title = isSorting ? 'Sắp xếp' : 'Nguyên liệu'
    const borderCls = isSorting ? 'border-primary/10' : 'border-primary/20'

    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex flex-row gap-2 flex-1">
                    <div className={`flex-1 bg-primary/5 border ${borderCls} shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center`}>
                        <span className="text-[12px] font-black text-primary uppercase line-clamp-1">{title}</span>
                        <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{count} loại</span>
                    </div>
                </div>
            </div>
        </header>
    )
}
