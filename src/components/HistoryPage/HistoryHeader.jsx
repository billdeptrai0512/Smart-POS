import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import HistoryTabsBar from './HistoryTabsBar'

export default function HistoryHeader({
    rangeLabel, totalCups, scope, isReadOnly,
    onBack, onForward,
    // Tabs row (moved from footer)
    activeTab, onTabSelect,
    // Week/month mode
    canGoForward, onOffsetPrev, onOffsetNext,
    // Day mode (picker)
    dayInputValue, dayCustomDate, todayISO, canGoForwardDay,
    onPrevDay, onNextDay, onDateChange, onEndDatePick, hasManualPick,
    // Custom range mode
    customRange, onCustomStartChange, onCustomEndChange,
    // Optional slot: extra row rendered below the tabs bar inside the sticky
    // header (e.g. DailyReportPage's Dòng tiền / Tồn kho / Lợi nhuận filter).
    belowTabs,
}) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Nhật ký</span>
                    {!isReadOnly ? (
                        scope === 'day' ? (
                            <DayPicker
                                dayInputValue={dayInputValue}
                                dayCustomDate={dayCustomDate}
                                rangeLabel={rangeLabel}
                                todayISO={todayISO}
                                canGoForwardDay={canGoForwardDay}
                                onPrev={onPrevDay}
                                onNext={onNextDay}
                                onChange={onDateChange}
                                onEndDatePick={onEndDatePick}
                                hasManualPick={hasManualPick}
                            />
                        ) : scope === 'custom' ? (
                            <CustomRangePicker
                                customRange={customRange}
                                todayISO={todayISO}
                                onStartChange={onCustomStartChange}
                                onEndChange={onCustomEndChange}
                            />
                        ) : (
                            <RangeNav
                                rangeLabel={rangeLabel}
                                canGoForward={canGoForward}
                                onPrev={onOffsetPrev}
                                onNext={onOffsetNext}
                            />
                        )
                    ) : (
                        <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{totalCups} ly</span>
                    )}
                </div>

                <button
                    onClick={onForward}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                >
                    <ArrowRight size={20} strokeWidth={2.5} />
                </button>
            </div>

            <HistoryTabsBar activeTab={activeTab} onSelect={onTabSelect} />
            {belowTabs}
        </header>
    )
}

function DayPicker({ dayInputValue, dayCustomDate, rangeLabel, todayISO, canGoForwardDay, onPrev, onNext, onChange, onEndDatePick, hasManualPick }) {
    // Surface "→ ngày" chip only after a manual calendar pick — chevron stepping must NOT trigger it.
    const showEndChip = hasManualPick && !!dayCustomDate && dayCustomDate < todayISO
    const display = dayCustomDate
        ? (showEndChip
            ? `${dayCustomDate.split('-')[2]}/${dayCustomDate.split('-')[1]}`
            : `${dayCustomDate.split('-')[2]}/${dayCustomDate.split('-')[1]}/${dayCustomDate.split('-')[0]}`)
        : rangeLabel
    return (
        <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
            {!showEndChip && (
                <button
                    onClick={onPrev}
                    className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
                >
                    <ChevronLeft size={14} strokeWidth={2.5} />
                </button>
            )}
            <div className="relative flex items-center justify-center px-1">
                <input
                    type="date"
                    value={dayInputValue}
                    onChange={(e) => onChange(e.target.value)}
                    max={todayISO}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4 relative z-0 pointer-events-none">
                    {display}
                </span>
            </div>
            {showEndChip && (
                <>
                    <span className="text-[11px] font-bold text-text-secondary leading-none">→</span>
                    <div className="relative flex items-center justify-center px-1">
                        <input
                            type="date"
                            value={dayCustomDate}
                            min={dayCustomDate}
                            max={todayISO}
                            onChange={(e) => onEndDatePick?.(e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                        />
                        <span className="text-[11px] font-bold text-text-dim leading-none italic underline decoration-dotted decoration-text-dim/40 underline-offset-4 relative z-0 pointer-events-none">
                            ngày
                        </span>
                    </div>
                </>
            )}
            {!showEndChip && (
                <button
                    onClick={onNext}
                    className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canGoForwardDay ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
                >
                    <ChevronRight size={14} strokeWidth={2.5} />
                </button>
            )}
        </div>
    )
}

function CustomRangePicker({ customRange, todayISO, onStartChange, onEndChange }) {
    const fmtDisplay = (iso) => iso ? `${iso.split('-')[2]}/${iso.split('-')[1]}` : '—'
    const startISO = customRange?.startISO || todayISO
    const endISO = customRange?.endISO || todayISO
    return (
        <div className="flex items-center gap-1.5 pointer-events-auto mt-0.5">
            <DateInputChip value={startISO} max={endISO} onChange={onStartChange} label={fmtDisplay(customRange?.startISO)} />
            <span className="text-[11px] font-bold text-text-secondary leading-none">→</span>
            <DateInputChip value={endISO} min={startISO} max={todayISO} onChange={onEndChange} label={fmtDisplay(customRange?.endISO)} />
        </div>
    )
}

function DateInputChip({ value, min, max, onChange, label }) {
    return (
        <div className="relative flex items-center justify-center px-1">
            <input
                type="date"
                value={value}
                min={min}
                max={max}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
            <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4 relative z-0 pointer-events-none">
                {label}
            </span>
        </div>
    )
}

function RangeNav({ rangeLabel, canGoForward, onPrev, onNext }) {
    return (
        <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
            <button
                onClick={onPrev}
                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
            >
                <ChevronLeft size={14} strokeWidth={2.5} />
            </button>
            <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums">{rangeLabel}</span>
            <button
                onClick={() => canGoForward && onNext()}
                className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canGoForward ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
            >
                <ChevronRight size={14} strokeWidth={2.5} />
            </button>
        </div>
    )
}
