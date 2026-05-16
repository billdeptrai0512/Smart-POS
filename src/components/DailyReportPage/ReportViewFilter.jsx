import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

export const VIEW_ALL = 'all'
export const VIEW_PROFIT = 'profit'
export const VIEW_CASHFLOW = 'cashflow'
export const VIEW_INVENTORY = 'inventory'

const MENU = [
    { key: VIEW_ALL, label: 'Tất cả' },
    { key: VIEW_PROFIT, label: 'Lợi nhuận' },
    { key: VIEW_CASHFLOW, label: 'Dòng tiền' },
    { key: VIEW_INVENTORY, label: 'Tồn kho' },
]

const LABELS = Object.fromEntries(MENU.map(m => [m.key, m.label]))

// Divider-as-trigger: line | LABEL ▾ | line.
// Doubles as section heading + filter, so it consumes no extra vertical space.
export default function ReportViewFilter({ value, onChange }) {
    const [open, setOpen] = useState(false)
    const label = LABELS[value] || LABELS[VIEW_ALL]

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 py-1 my-1 px-4 group"
            >
                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                <span className="flex items-center gap-1 text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80 group-hover:text-text group-hover:opacity-100 transition-colors">
                    {label}
                    <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 bg-surface border border-border/60 rounded-[12px] shadow-xl overflow-hidden min-w-[140px]">
                        {MENU.map(item => (
                            <button
                                key={item.key}
                                onClick={() => { onChange(item.key); setOpen(false) }}
                                className={`w-full text-center px-3 py-2 text-[11px] uppercase font-black tracking-widest transition-colors ${value === item.key ? 'text-text bg-primary/10' : 'text-text-secondary hover:text-text hover:bg-surface-light'}`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
