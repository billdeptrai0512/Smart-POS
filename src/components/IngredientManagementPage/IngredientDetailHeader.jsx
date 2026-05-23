import { ArrowLeft, ArrowRight } from 'lucide-react'
import MenuTabsBar from '../common/MenuTabsBar'

const VIEW_TABS = [
    { key: 'details', label: 'Chi tiết' },
    { key: 'history', label: 'Nhật ký' },
]

// Mirrors IngredientsHeader layout so the detail page feels like a sub-view
// of /ingredients rather than a standalone screen.
export default function IngredientDetailHeader({
    title,
    subtitle,
    onBack,
    onForward,
    onMenuTabSelect,
    viewMode = 'details',
    onViewModeChange,
}) {
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

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1 truncate w-full">{title}</span>
                    {subtitle && (
                        <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{subtitle}</span>
                    )}
                </div>

                {onForward && (
                    <button
                        onClick={onForward}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Tiếp"
                    >
                        <ArrowRight size={20} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            <MenuTabsBar activeTab="ingredients" onSelect={onMenuTabSelect} />

            {onViewModeChange && (
                <div className="flex gap-1 bg-surface-light border border-border/40 rounded-[12px] p-1">
                    {VIEW_TABS.map(t => {
                        const active = viewMode === t.key
                        return (
                            <button
                                key={t.key}
                                onClick={() => onViewModeChange(t.key)}
                                className={`flex-1 py-1.5 rounded-[8px] text-[11px] font-black uppercase tracking-wider transition-all ${active ? 'bg-surface text-primary shadow-sm' : 'text-text-secondary hover:text-text'}`}
                            >
                                {t.label}
                            </button>
                        )
                    })}
                </div>
            )}
        </header>
    )
}
