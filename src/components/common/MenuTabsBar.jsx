// Shared tab bar for the Menu/Ingredients dashboard — mirrors HistoryTabsBar so
// /recipes ↔ /ingredients feels like one page split into tabs, even though each
// keeps its own route + state. Active color is the primary brand orange.

const TABS = [
    { key: 'recipes',     label: 'Công thức',       activeColor: 'bg-primary' },
    { key: 'ingredients', label: 'Nguyên vật liệu', activeColor: 'bg-primary' },
]

export default function MenuTabsBar({ activeTab, onSelect }) {
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
