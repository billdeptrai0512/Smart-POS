const TABS = [
    { key: 'orders', label: 'Thu nhập', activeColor: 'bg-primary' },
    { key: 'expense', label: 'Chi phí', activeColor: 'bg-danger' },
    { key: 'report', label: 'Báo cáo', activeColor: 'bg-success' },
]

export default function HistoryTabsBar({ activeTab, onSelect }) {
    return (
        <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
            {TABS.map(tab => {
                const active = activeTab === tab.key
                return (
                    <button
                        key={tab.key}
                        onClick={() => onSelect?.(tab.key)}
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
    )
}
