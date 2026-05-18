import { ArrowLeft, Check } from 'lucide-react'
import { formatVND } from '../../utils'

const TABS = [
    { key: 'inventory', label: 'Tồn kho',  activeColor: 'bg-primary' },
    { key: 'revenue',   label: 'Thực thu', activeColor: 'bg-success' },
    { key: 'note',      label: 'Ghi chú',  activeColor: 'bg-warning' },
]

export default function ShiftClosingHeader({
    systemTotalRevenue, isSubmitting, isDisabled,
    onBack, onSubmit,
    activeTab, onTabSelect,
}) {
    return (
        <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Chốt ca</span>
                    <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{formatVND(systemTotalRevenue)}</span>
                </div>

                <button
                    onClick={onSubmit}
                    disabled={isDisabled}
                    className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-success/10 border-border/60 transition-colors shadow-sm focus:outline-none"
                >
                    {isSubmitting ? (
                        <div className="w-5 h-5 border-2 border-success border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <Check size={20} className='text-success' strokeWidth={3} />
                    )}
                </button>
            </div>

            {activeTab && (
                <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
                    {TABS.map(tab => {
                        const active = activeTab === tab.key
                        return (
                            <button
                                key={tab.key}
                                onClick={() => onTabSelect?.(tab.key)}
                                className={`flex-1 flex items-center justify-center py-2 rounded-[10px] transition-all duration-200
                                    ${active ? `${tab.activeColor} shadow-sm` : 'hover:bg-border/30'}`}
                            >
                                <span className={`text-[11px] font-black uppercase tracking-wider transition-colors
                                    ${active ? 'text-bg' : 'text-text-secondary'}`}>
                                    {tab.label}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </header>
    )
}
