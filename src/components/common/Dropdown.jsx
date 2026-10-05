import { Fragment, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useClickOutside } from '../../hooks/useClickOutside'

// Dropdown tự vẽ thay <select> native (option/optgroup native không style được — nền trắng,
// căn lệch). Cùng phong cách SelectRow/OptionRow ở AddExpenseModal, panel mở XUỐNG dưới.
// align: panel bám mép phải ('right', mặc định) hay mép trái ('left') của nút — nút đứng sát lề trái thì dùng 'left',
// kẻo panel rộng hơn nút tràn ra ngoài màn hình.
// items: { value, label, count?, divider? } = lựa chọn (divider = vạch ngăn phía trên) | { action, label, onClick } = dòng hành động (vd. "Quản lý"), đặt ở vị trí tuỳ ý trong items.
export default function Dropdown({ value, items, onChange, triggerLabel, disabled, className = '', triggerClassName = '', ariaLabel, align = 'right' }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useClickOutside(ref, () => setOpen(false), { active: open, escape: true })

    const pick = (fn) => { setOpen(false); fn() }

    return (
        <div ref={ref} className={`relative ${className}`}>
            <button
                type="button"
                disabled={disabled}
                aria-label={ariaLabel}
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className={`flex items-center justify-between gap-1.5 w-full min-w-0 font-bold text-text disabled:opacity-60 ${triggerClassName}`}
            >
                <span className="truncate">{triggerLabel}</span>
                <ChevronDown size={16} className={`text-text-secondary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className={`absolute top-full ${align === 'left' ? 'left-0' : 'right-0'} mt-1.5 z-30 min-w-full w-max max-w-[80vw] bg-surface border border-border/60 rounded-[12px] shadow-xl p-1.5 flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto hide-scrollbar`}>
                    {items.map(it => it.action ? (
                        <button
                            key={it.action}
                            type="button"
                            onClick={() => pick(it.onClick)}
                            className="py-2 px-2.5 text-left text-[13px] font-bold text-primary"
                        >
                            {it.label}
                        </button>
                    ) : (
                        <Fragment key={it.value}>
                        {it.divider && <div className="my-1 border-t border-border/40" />}
                        <button
                            type="button"
                            onClick={() => pick(() => it.value !== value && onChange(it.value))}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-[10px] text-left text-[13px] font-bold transition-colors ${it.value === value ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-surface-light hover:text-text'}`}
                        >
                            <span className="flex-1 min-w-0 truncate">{it.label}</span>
                            {it.count != null && <span className="shrink-0 tabular-nums font-semibold text-text-dim">{it.count}</span>}
                        </button>
                        </Fragment>
                    ))}
                </div>
            )}
        </div>
    )
}
