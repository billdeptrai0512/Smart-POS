const SCOPE_OPTIONS = [
    { key: 'week', label: 'Tuần này' },
    { key: 'day', label: 'Hôm nay' },
    { key: 'month', label: 'Tháng này' },
]

export default function HistoryFooter({ scope, onScopeChange, isReadOnly }) {
    if (isReadOnly) return null
    return (
        <div className="shrink-0 bg-surface/80 backdrop-blur-md border-t border-border/40 px-4 py-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
            <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
                {SCOPE_OPTIONS.map(s => {
                    const active = scope === s.key
                    return (
                        <button
                            key={s.key}
                            onClick={() => onScopeChange?.(s.key)}
                            className={`flex-1 py-2 rounded-[10px] text-[11px] font-black uppercase tracking-wider transition-all duration-150 ${
                                active
                                    ? 'bg-primary text-bg shadow-sm'
                                    : 'text-text-secondary hover:text-text hover:bg-border/30'
                            }`}
                        >
                            {s.label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
