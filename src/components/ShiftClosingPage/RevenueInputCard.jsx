import SectionDivider from './SectionDivider'

export default function RevenueInputCard({
    actualCash, actualTransfer, isSubmitting,
    onCashChange, onTransferChange,
}) {
    return (
        <div>
            <SectionDivider label="Thực nhận" />
            <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm space-y-3">
                <MoneyRow label="Tiền mặt" value={actualCash} disabled={isSubmitting} onChange={onCashChange} />
                <MoneyRow label="Chuyển khoản" value={actualTransfer} disabled={isSubmitting} onChange={onTransferChange} />
            </div>
        </div>
    )
}

function MoneyRow({ label, value, disabled, onChange }) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-[13px] font-bold text-text w-[110px] shrink-0">{label}</span>
            <div className="relative flex-1 flex items-center bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Số tiền..."
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    disabled={disabled}
                    className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {value && (
                    <span className="text-[14px] font-medium text-text-secondary pr-3 shrink-0 pointer-events-none">đ</span>
                )}
            </div>
        </div>
    )
}
