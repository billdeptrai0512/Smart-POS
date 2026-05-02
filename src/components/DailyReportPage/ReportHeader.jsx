import { ArrowLeft, ChevronLeft, ChevronRight, Pen } from 'lucide-react'

const RANGES = [
    { key: 'day', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'month', label: 'Tháng này' },
]

const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

export function getDateRange(range, offset = 0) {
    const now = new Date()
    if (range === 'week') {
        const todayDiff = (now.getDay() + 6) % 7
        const thisMonday = new Date(now)
        thisMonday.setDate(now.getDate() - todayDiff)
        thisMonday.setHours(0, 0, 0, 0)
        const start = new Date(thisMonday)
        start.setDate(thisMonday.getDate() + offset * 7)
        const end = new Date(start)
        end.setDate(start.getDate() + 6)
        end.setHours(23, 59, 59, 999)
        const days = offset === 0 ? todayDiff + 1 : 7
        return { start, end, days }
    }
    if (range === 'month') {
        const year = now.getFullYear()
        const month = now.getMonth() + offset
        const start = new Date(year, month, 1, 0, 0, 0, 0)
        if (offset === 0) {
            const end = new Date(now)
            end.setHours(23, 59, 59, 999)
            return { start, end, days: now.getDate() }
        }
        const end = new Date(year, month + 1, 0, 23, 59, 59, 999)
        return { start, end, days: end.getDate() }
    }
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end = new Date(now); end.setHours(23, 59, 59, 999)
    return { start, end, days: 1 }
}

function getSubtitle(range, offset) {
    const now = new Date()
    if (range === 'day') return `${fmt(now)}/${now.getFullYear()}`
    const { start, end } = getDateRange(range, offset)
    return `${fmt(start)} – ${fmt(end)}`
}

export default function ReportHeader({ onBack, onEditShiftClosing, selectedRange = 'day', onNavigateRange, offset = 0, onOffsetChange }) {
    const subtitle = getSubtitle(selectedRange, offset)
    const canGoForward = offset < 0

    return (
        <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col gap-3 px-4">
            {/* Row 1: Back / Title+Nav / Shift closing */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none relative z-10"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Báo cáo</span>
                    {selectedRange === 'day' ? (
                        <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{subtitle}</span>
                    ) : (
                        <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
                            <button
                                onClick={() => onOffsetChange?.(offset - 1)}
                                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
                            >
                                <ChevronLeft size={14} strokeWidth={2.5} />
                            </button>
                            <span className="text-[12px] font-bold text-text/80 leading-none mt-0.5 tabular-nums">{subtitle}</span>
                            <button
                                onClick={() => canGoForward && onOffsetChange?.(offset + 1)}
                                className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canGoForward ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
                            >
                                <ChevronRight size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    )}
                </div>

                <button
                    onClick={onEditShiftClosing}
                    className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-primary/10 border-border/60 text-primary text-[14px] font-black uppercase tracking-wide active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm pointer-events-auto flex items-center justify-center gap-2"
                    title="Cập nhật chốt ca"
                >
                    <Pen size={18} strokeWidth={2.5} />

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
