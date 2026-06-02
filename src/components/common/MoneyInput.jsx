import { formatVNDInput } from '../../utils'

// Single visual style for every money input in the app:
//   ┌──────────────────────┐
//   │       880.000     đ  │
//   └──────────────────────┘
// Right-aligned, tabular-nums, thousand-separator formatted on every keystroke.
// Caller stores the FORMATTED string (e.g. "880.000") and uses parseVNDInput
// on submit to get the raw number. No more ".000đ" hint + ×1000 shortcut —
// staff types the full amount, matches what they see on receipts/cash.
//
// Use over a raw <input type="number"> whenever the value represents VND.
export default function MoneyInput({
    value,
    onChange,
    onKeyDown,
    onBlur,
    placeholder = '0',
    disabled = false,
    autoFocus = false,
    inputRef,
    size = 'md',           // 'sm' (history row) | 'md' (default) | 'lg' (hero amount)
    align = 'right',       // 'right' (default) | 'left' | 'center'
    weight = 'bold',       // 'bold' (default) | 'medium' — đồng bộ với input text thường
    className = '',
}) {
    const sizeCls = {
        sm: 'px-2.5 py-1.5 text-[13px]',
        md: 'px-3 py-2.5 text-[14px]',
        lg: 'px-4 py-3 text-[16px]',
    }[size] || 'px-3 py-2.5 text-[14px]'

    const alignCls = align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right'
    const weightCls = weight === 'medium' ? 'font-medium' : 'font-bold'

    return (
        <div className={`relative flex items-center bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden ${className}`}>
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                value={value || ''}
                onChange={e => onChange?.(formatVNDInput(e.target.value))}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
                placeholder={placeholder}
                disabled={disabled}
                autoFocus={autoFocus}
                className={`w-full bg-transparent ${sizeCls} ${alignCls} ${weightCls} text-text tabular-nums placeholder:text-text-secondary/40 focus:outline-none disabled:opacity-50`}
            />
            {value && (
                <span className="text-[12px] font-bold text-text-secondary pr-2.5 shrink-0 pointer-events-none">đ</span>
            )}
        </div>
    )
}
