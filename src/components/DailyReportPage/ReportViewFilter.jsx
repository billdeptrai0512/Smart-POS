export const VIEW_ALL = 'all'
export const VIEW_PROFIT = 'profit'
export const VIEW_CASHFLOW = 'cashflow'
export const VIEW_INVENTORY = 'inventory'

const MENU = [
    { key: VIEW_PROFIT, label: 'Lợi nhuận' },
    { key: VIEW_CASHFLOW, label: 'Dòng tiền' },
    { key: VIEW_INVENTORY, label: 'Tồn kho' },
]

// Card-style segmented control — visually part of the main panel family.
export default function ReportViewFilter({ value, onChange }) {
    return (
        <div className="bg-surface border border-border/60 rounded-[14px] p-1 shadow-sm flex gap-1">
            {MENU.map(item => {
                const active = value === item.key
                return (
                    <button
                        key={item.key}
                        type="button"
                        onClick={() => onChange(item.key)}
                        className={`flex-1 py-2 rounded-[10px] text-[11px] font-black uppercase tracking-wider transition-all duration-150
                            ${active
                                ? 'bg-primary text-bg shadow-sm'
                                : 'text-text-secondary hover:text-text hover:bg-border/30'
                            }`}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}
