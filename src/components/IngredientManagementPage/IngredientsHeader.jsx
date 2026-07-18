import { ArrowLeft, ArrowRight } from 'lucide-react'
import MenuTabsBar, { TABS } from '../common/MenuTabsBar'

export default function IngredientsHeader({
    count, isSorting, onBack, onForward,
    activeTab = 'main', onTabSelect,
}) {
    // While sorting, swap the title to "Sắp xếp" and hide the tabs so the dedicated
    // sort UI (footer "Hủy / Lưu") owns the screen — matches pre-merge behavior.
    const title = isSorting ? 'Sắp xếp' : (TABS.find(t => t.key === activeTab)?.label || 'Kho hàng')

    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1">{title}</span>
                    <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{count} loại</span>
                </div>

                {onForward && !isSorting && (
                    <button
                        onClick={onForward}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Tiếp"
                    >
                        <ArrowRight size={20} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            {!isSorting && <MenuTabsBar activeTab={activeTab} onSelect={onTabSelect} />}
        </header>
    )
}
