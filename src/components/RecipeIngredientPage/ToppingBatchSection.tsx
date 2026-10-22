interface Props {
    yieldValue: string
    serving: string
    unit: string
    canEdit: boolean
    onYield: (v: string) => void
    onServing: (v: string) => void
    onCommit: () => void
}

const INPUT = 'w-24 h-11 px-2 text-right rounded-[12px] bg-bg border border-border/60 text-text text-[14px] focus:outline-none focus:border-primary/60 disabled:opacity-60'

// Từ 2 nguyên liệu trở lên topping là thành phẩm tự nấu: lượng trong danh sách là cho 1 mẻ, nên cần sản lượng mẻ + lượng trừ mỗi phần bán.
export default function ToppingBatchSection({ yieldValue, serving, unit, canEdit, onYield, onServing, onCommit }: Props) {
    const field = (label: string, value: string, suffix: string, onChange: (v: string) => void) => (
        <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-text-secondary">{label}</span>
            <div className="flex items-center gap-1">
                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    disabled={!canEdit}
                    onChange={e => onChange(e.target.value.replace(',', '.'))}
                    onBlur={onCommit}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    placeholder="—"
                    aria-label={label}
                    className={INPUT}
                />
                <span className="text-[13px] text-text-secondary w-12">{suffix}</span>
            </div>
        </div>
    )
    return (
        <section className="rounded-[14px] bg-surface border border-border/60 p-3 space-y-3">
            {field('1 mẻ ra', yieldValue, unit, onYield)}
            {field('Mỗi phần bán trừ', serving, `${unit}/phần`, onServing)}
            <p className="text-[12px] text-text-dim">Nguyên liệu ở trên là cho 1 mẻ. Nhập đủ hai ô này thì topping mới trừ kho; nấu một mẻ cộng vào tồn topping, bán một phần trừ đúng lượng mỗi phần.</p>
        </section>
    )
}
