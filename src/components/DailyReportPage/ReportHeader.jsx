import { ArrowLeft, Pencil } from 'lucide-react'

const RANGES = [
    { key: 'day', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
]

const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

function getDateSubtitle(range) {
    const now = new Date()
    if (range === 'day') {
        return `${fmt(now)}/${now.getFullYear()}`
    }
    if (range === 'week') {
        const diff = (now.getDay() + 6) % 7
        const start = new Date(now)
        start.setDate(now.getDate() - diff)
        return `${fmt(start)} – ${fmt(now)}`
    }
    if (range === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1)
        return `${fmt(start)} – ${fmt(now)}`
    }
    return ''
}

export default function ReportHeader({ onBack, onEditShiftClosing, selectedRange = 'day', onNavigateRange }) {
    const dateSubtitle = getDateSubtitle(selectedRange)

    return (
        <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col gap-3 px-4">
            {/* Row 1: Back / Title / Shift closing */}
            <div className="relative flex items-center justify-between">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none relative z-10"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <h1 className="text-[16px] font-black uppercase text-primary tracking-wider">Báo Cáo</h1>
                    <span className="text-[11px] font-medium text-text-secondary">{dateSubtitle}</span>
                </div>

                <button
                    onClick={onEditShiftClosing}
                    className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none relative z-10"
                    title="Cập nhật chốt ca"
                >
                    <Pencil size={16} className="text-text" strokeWidth={2.5} />
                </button>
            </div>

            {/* Row 2: Range tabs */}
            <div className="grid grid-cols-3 gap-2">
                {RANGES.map(r => (
                    <button
                        key={r.key}
                        onClick={() => onNavigateRange?.(r.key)}
                        className={`py-2 rounded-[12px] text-[12px] font-black border transition-colors ${selectedRange === r.key
                            ? 'bg-primary/10 border-primary/40 text-primary'
                            : 'bg-surface-light border-border/60 text-text-secondary hover:bg-border/30'
                            }`}
                    >
                        {r.label}
                    </button>
                ))}
            </div>
        </header>
    )
}
