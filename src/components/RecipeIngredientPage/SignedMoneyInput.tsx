import type { KeyboardEventHandler, ReactNode } from 'react'
import { formatSignedVNDInput } from '../../utils'

// Ô cộng/trừ gom 1 khối: nút dấu ± bên trái + ô nhập (children) + hậu tố tùy chọn. Nút dấu chặn
// mousedown để input không mất focus (blur sẽ commit/đóng editor). Dùng cho giá tùy chọn
// (SignedMoneyInput bên dưới) và định lượng nguyên liệu của tùy chọn (FastIngredientFill).
export const SIGNED_INPUT_CLASS = 'flex-1 min-w-0 h-full bg-transparent px-2 text-[13px] text-text text-right focus:outline-none disabled:opacity-60 no-spin'

export function SignedBox({ negative, onToggle, suffix, className = 'w-[132px]', saved, children }: {
    negative: boolean
    saved?: boolean // vừa lưu xong → viền xanh
    onToggle: () => void
    suffix?: ReactNode
    className?: string
    children: ReactNode
}) {
    return (
        <div className={`shrink-0 h-9 flex items-center bg-bg border rounded-lg overflow-hidden transition-colors focus-within:border-primary ${saved ? 'border-success' : 'border-border/60'} ${className}`}>
            <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={onToggle}
                className={`shrink-0 w-8 h-full flex items-center justify-center border-r border-border/60 text-[16px] font-bold ${negative ? 'bg-danger/15 text-danger' : 'bg-success/10 text-success'}`}
                title="Đổi dấu âm/dương"
            >
                {negative ? '−' : '+'}
            </button>
            {children}
            {suffix && <span className="shrink-0 pr-2 text-[12px] text-text-dim">{suffix}</span>}
        </div>
    )
}

// Ô giá cộng/trừ: số tiền tự chấm hàng nghìn + "đ". Dùng cho thêm tùy chọn (ExtrasSection) và sửa
// giá tùy chọn (InlineEditor). `value`/`onChange` là chuỗi đã format, vd "-10.000".
interface Props {
    value: string
    onChange: (value: string) => void
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>
    onBlur?: () => void
    autoFocus?: boolean
}

export default function SignedMoneyInput({ value, onChange, onKeyDown, onBlur, autoFocus }: Props) {
    const negative = value.startsWith('-')
    return (
        <SignedBox negative={negative} onToggle={() => onChange(negative ? value.slice(1) : '-' + value)} suffix="đ">
            <input
                type="text"
                inputMode="decimal"
                placeholder="Giá"
                autoFocus={autoFocus}
                className={SIGNED_INPUT_CLASS}
                value={value}
                onChange={e => onChange(formatSignedVNDInput(e.target.value))}
                onKeyDown={onKeyDown}
                onBlur={onBlur}
            />
        </SignedBox>
    )
}
