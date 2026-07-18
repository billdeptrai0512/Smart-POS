// Shared tab bar for the Menu/Ingredients dashboard. Three tabs span both
// /recipes (Công thức) and /ingredients (Nguyên liệu / Bao bì sub-views).
// The parent owns active selection: pass 'recipes' on Recipe pages, or the
// ingredient viewMode ('main' / 'packaging') on the Ingredients page.

export const TABS = [
    { key: 'recipes',   label: 'Công thức' },
    { key: 'main',      label: 'Nguyên liệu' },
    { key: 'packaging', label: 'Bao bì' },
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
                        className={`flex-1 flex items-center justify-center py-2 rounded-[10px] transition-all duration-200 ${active ? 'bg-primary shadow-sm' : 'hover:bg-border/30'}`}
                    >
                        <span className={`text-[11px] font-black uppercase tracking-wider transition-colors ${active ? 'text-bg' : 'text-text-secondary'}`}>
                            {tab.label}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
