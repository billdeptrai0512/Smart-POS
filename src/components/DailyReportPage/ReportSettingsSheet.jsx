import { Pencil, X } from 'lucide-react'

const RANGES = [
    { key: 'day', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
]

export default function ReportSettingsSheet({ open, onClose, selectedRange = 'day', onNavigateRange, onEditShiftClosing }) {
    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />

            {/* Sheet */}
            <div className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-surface rounded-t-[28px] z-50 transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full'}`}>
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-10 h-1 rounded-full bg-border/60" />
                </div>

                <div className="px-5 pt-3 pb-8 flex flex-col gap-5">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <span className="text-[15px] font-black text-text uppercase tracking-wider">Xem báo cáo</span>
                        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary">
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Range selector */}
                    <div className="grid grid-cols-3 gap-2">
                        {RANGES.map(r => (
                            <button
                                key={r.key}
                                onClick={() => onNavigateRange(r.key)}
                                className={`py-2.5 rounded-[14px] text-[13px] font-black border transition-colors ${selectedRange === r.key
                                    ? 'bg-primary/10 border-primary/40 text-primary'
                                    : 'bg-surface-light border-border/60 text-text-secondary hover:bg-border/30'
                                    }`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>

                    {/* Divider */}
                    <div className="h-[1px] bg-border/40 rounded-full" />

                    {/* Shift closing */}
                    <button
                        onClick={onEditShiftClosing}
                        className="flex items-center gap-3 w-full px-4 py-3 rounded-[16px] bg-surface-light border border-border/60 hover:bg-border/30 active:bg-border/50 transition-colors"
                    >
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <Pencil size={15} className="text-primary" strokeWidth={2.5} />
                        </div>
                        <div className="flex flex-col items-start">
                            <span className="text-[13px] font-black text-text">Cập nhật chốt ca</span>
                            <span className="text-[11px] text-text-secondary">Chỉnh sửa thông tin ca hôm nay</span>
                        </div>
                    </button>
                </div>
            </div>
        </>
    )
}
