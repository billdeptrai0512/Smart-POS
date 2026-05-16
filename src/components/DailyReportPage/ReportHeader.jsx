import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import HistoryTabsBar from '../HistoryPage/HistoryTabsBar'

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

export default function ReportHeader({ onBack, onForward, selectedRange = 'day', offset = 0, onOffsetChange, customDate, onCustomDateChange, activeTab = 'report', onTabSelect }) {
    const { isStaff } = useAuth()
    const subtitle = getSubtitle(selectedRange, offset)
    const canGoForward = offset < 0

    // Format customDate or today for input value
    const getLocalISO = (date = new Date()) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
    const todayISO = getLocalISO(new Date())
    const inputValue = customDate || todayISO

    const handlePrevDay = () => {
        if (!onCustomDateChange) return
        const parts = inputValue.split('-')
        const d = new Date(parts[0], parts[1] - 1, parts[2])
        d.setDate(d.getDate() - 1)
        const prevISO = getLocalISO(d)
        onCustomDateChange(prevISO)
    }

    const handleNextDay = () => {
        if (!onCustomDateChange) return
        if (inputValue >= todayISO) return
        const parts = inputValue.split('-')
        const d = new Date(parts[0], parts[1] - 1, parts[2])
        d.setDate(d.getDate() + 1)
        const nextISO = getLocalISO(d)
        if (nextISO >= todayISO) {
            onCustomDateChange(null)
        } else {
            onCustomDateChange(nextISO)
        }
    }

    const canGoForwardDay = inputValue < todayISO

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
                        !isStaff ? (
                            <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
                                <button
                                    onClick={handlePrevDay}
                                    className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
                                >
                                    <ChevronLeft size={14} strokeWidth={2.5} />
                                </button>
                                <div className="relative flex items-center justify-center px-1">
                                    <input
                                        type="date"
                                        value={inputValue}
                                        onChange={(e) => {
                                            if (e.target.value >= todayISO) onCustomDateChange?.(null)
                                            else onCustomDateChange?.(e.target.value)
                                        }}
                                        max={todayISO}
                                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                                    />
                                    <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4 relative z-0 pointer-events-none">
                                        {customDate ? `${customDate.split('-')[2]}/${customDate.split('-')[1]}/${customDate.split('-')[0]}` : subtitle}
                                    </span>
                                </div>
                                <button
                                    onClick={handleNextDay}
                                    className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canGoForwardDay ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
                                >
                                    <ChevronRight size={14} strokeWidth={2.5} />
                                </button>
                            </div>
                        ) : (
                            <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums">{subtitle}</span>
                        )
                    ) : (
                        <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
                            <button
                                onClick={() => onOffsetChange?.(offset - 1)}
                                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
                            >
                                <ChevronLeft size={14} strokeWidth={2.5} />
                            </button>
                            <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums">{subtitle}</span>
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
                    onClick={onForward}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    title="Tiếp theo"
                >
                    <ArrowRight size={20} strokeWidth={2.5} />
                </button>
            </div>

            {/* Row 2: Tabs (Thu nhập / Chi phí / Báo cáo) */}
            <HistoryTabsBar activeTab={activeTab} onSelect={onTabSelect} />
        </header>
    )
}
