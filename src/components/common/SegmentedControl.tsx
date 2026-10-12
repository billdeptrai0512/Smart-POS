interface Props<T extends string | boolean> {
    options: { value: T; label: string }[]
    value: T
    onChange?: (value: T) => void
    /** Khung ngoài (độ rộng, nền, viền, bo). Mặc định: full-width, nền surface-light. */
    className?: string
    /** Cỡ nút. Mặc định chia đều chiều ngang, chữ 12px. */
    buttonClassName?: string
}

// Nút chọn 1-trong-N dạng "pill" (Tiền mặt/Bank, Trong ca/Sau ca, đ/%, đơn vị số lượng...).
export default function SegmentedControl<T extends string | boolean>({
    options, value, onChange,
    className = 'w-full bg-surface-light border border-border/60 rounded-lg',
    buttonClassName = 'flex-1 px-1 py-2 text-[12px]',
}: Props<T>) {
    return (
        <div className={`flex items-center gap-0.5 p-0.5 ${className}`}>
            {options.map(opt => (
                <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => onChange?.(opt.value)}
                    className={`${buttonClassName} rounded-md font-bold transition-all ${value === opt.value ? 'bg-primary text-white' : 'text-text-secondary'}`}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}
