import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import HistoryTabsBar from '../HistoryPage/HistoryTabsBar'
import DatePicker from '../common/DatePicker'
import { formatIsoDisplay } from '../common/datePickerUtils'
import { startOfDayVN, endOfDayVN, startOfWeekVN, startOfMonthVN, endOfMonthVN, addDaysVN, dateStringVN } from '../../utils/dateVN'

// Display "dd/mm" using VN-local components.
const fmt = (d) => {
    const [y, m, day] = dateStringVN(d).split('-')
    return `${day}/${m}`
}

export function getDateRange(range, offset = 0) {
    if (range === 'week') {
        const thisMonday = startOfWeekVN()
        const start = addDaysVN(thisMonday, offset * 7)
        const end = new Date(addDaysVN(start, 7).getTime() - 1)
        // Current week: count up to today; past/future weeks always 7 days.
        const todayDiff = Math.round((startOfDayVN().getTime() - thisMonday.getTime()) / 86_400_000)
        const days = offset === 0 ? todayDiff + 1 : 7
        return { start, end, days }
    }
    if (range === 'month') {
        const start = startOfMonthVN(new Date(), offset)
        if (offset === 0) {
            const today = startOfDayVN()
            return { start, end: endOfDayVN(), days: Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1 }
        }
        const end = endOfMonthVN(new Date(), offset)
        // # days in that month = (end - start) / day + 1
        const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
        return { start, end, days }
    }
    return { start: startOfDayVN(), end: endOfDayVN(), days: 1 }
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
                                <DatePicker
                                    value={inputValue}
                                    max={todayISO}
                                    onChange={(iso) => {
                                        if (iso >= todayISO) onCustomDateChange?.(null)
                                        else onCustomDateChange?.(iso)
                                    }}
                                    presets={false}
                                    trigger={(_label, toggle) => (
                                        <button
                                            type="button"
                                            onClick={toggle}
                                            className="text-[12px] font-bold text-text/80 leading-none tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4"
                                        >
                                            {customDate ? formatIsoDisplay(customDate) : subtitle}
                                        </button>
                                    )}
                                />
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
