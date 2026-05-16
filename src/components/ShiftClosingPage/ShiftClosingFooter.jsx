const TABS = [
    { key: 'inventory', label: 'Tồn kho', activeColor: 'bg-primary' },
    { key: 'revenue', label: 'Thực thu', activeColor: 'bg-success' },
    { key: 'note', label: 'Ghi chú', activeColor: 'bg-warning' },
]

export default function ShiftClosingFooter({ activeTab, onSelect }) {
    return (
        <div className="shrink-0 bg-surface/80 backdrop-blur-md border-t border-border/40 px-4 py-2.5 pb-[max(env(safe-area-inset-bottom),10px)]">
            <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
                {TABS.map(tab => {
                    const active = activeTab === tab.key
                    return (
                        <button
                            key={tab.key}
                            onClick={() => onSelect(tab.key)}
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
        </div>
    )
}
