// Unified day + custom-range date control via DatePicker (range mode).
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import HistoryTabsBar from './HistoryTabsBar'
import DatePicker from '../common/DatePicker'
import { formatIsoShort, formatIsoDisplay } from '../common/datePickerUtils'

export default function HistoryHeader({
    rangeLabel, totalCups, scope, isReadOnly,
    onBack, onForward,
    // Tabs row (moved from footer)
    activeTab, onTabSelect,
    // Week/month mode
    canGoForward, onOffsetPrev, onOffsetNext,
    // Day + custom share ONE range calendar. Tap a day then the same day again
    // → single day (scope 'day'); tap two different days → range (scope 'custom').
    dayInputValue, todayISO, canGoForwardDay,
    onPrevDay, onNextDay,
    customRange, onRangeChange,
    // Range scope: ‹ › shift the whole window by its own width.
    onShiftRange, canShiftRangeForward,
    // Preset chips inside the DatePicker popover (Hôm nay / Tuần này / Tháng này).
    // Page maps preset.scope back to its own scope state.
    onPresetSelect,
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
                        scope === 'week' || scope === 'month' ? (
                            <RangeNav
                                rangeLabel={rangeLabel}
                                canGoForward={canGoForward}
                                onPrev={onOffsetPrev}
                                onNext={onOffsetNext}
                                onPresetSelect={onPresetSelect}
                            />
                        ) : (
                            <DateRangePicker
                                scope={scope}
                                dayInputValue={dayInputValue}
                                customRange={customRange}
                                todayISO={todayISO}
                                canGoForwardDay={canGoForwardDay}
                                onPrevDay={onPrevDay}
                                onNextDay={onNextDay}
                                onRangeChange={onRangeChange}
                                onShiftRange={onShiftRange}
                                canShiftRangeForward={canShiftRangeForward}
                                onPresetSelect={onPresetSelect}
                            />
                        )
                    ) : (
                        <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums">{totalCups} ly</span>
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

// Dashed-underline chip shared by every header date control. DatePicker calls
// the returned fn with (label, toggle); pass `labelOverride` when the chip text
// differs from the picker's own value (range endpoints show '—' until set).
function chipTrigger({ labelOverride } = {}) {
    return (label, toggle) => (
        <button
            type="button"
            onClick={toggle}
            className="text-[12px] font-bold text-text/80 leading-none tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4"
        >
            {labelOverride ?? label}
        </button>
    )
}

// Unified day + custom-range control. Always a range-mode calendar: same day
// twice → single day, two days → range. The page decides scope from the emitted
// endpoints. Chevrons flank the chip in BOTH scopes:
//   • day scope    → step one day (onPrevDay / onNextDay).
//   • custom scope → shift the whole window by its own width (onShiftRange ∓1).
// The forward chevron is disabled once the window already touches today.
function DateRangePicker({ scope, dayInputValue, customRange, todayISO, canGoForwardDay, onPrevDay, onNextDay, onRangeChange, onShiftRange, canShiftRangeForward, onPresetSelect }) {
    const isDay = scope === 'day'
    // Feed the calendar the current selection so it highlights correctly: in day
    // scope that's a zero-width {day, day} range; in custom scope the real range.
    const value = isDay
        ? { startISO: dayInputValue, endISO: dayInputValue }
        : (customRange?.startISO ? customRange : null)
    // Single day → full dd/mm/yyyy; range → compact dd/mm – dd/mm.
    const label = isDay
        ? formatIsoDisplay(dayInputValue)
        : (value ? `${formatIsoShort(value.startISO)} – ${formatIsoShort(value.endISO)}` : 'Chọn ngày')

    const onPrev = isDay ? onPrevDay : () => onShiftRange?.(-1)
    const onNext = isDay ? onNextDay : () => onShiftRange?.(1)
    const canForward = isDay ? canGoForwardDay : canShiftRangeForward

    return (
        <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
            <button
                onClick={onPrev}
                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
            >
                <ChevronLeft size={14} strokeWidth={2.5} />
            </button>
            <DatePicker
                range
                value={value}
                max={todayISO}
                onChange={onRangeChange}
                onPresetSelect={onPresetSelect}
                trigger={chipTrigger({ labelOverride: label })}
            />
            <button
                onClick={() => canForward && onNext()}
                className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canForward ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
            >
                <ChevronRight size={14} strokeWidth={2.5} />
            </button>
        </div>
    )
}

function RangeNav({ rangeLabel, canGoForward, onPrev, onNext, onPresetSelect }) {
    return (
        <div className="flex items-center gap-1 pointer-events-auto mt-0.5">
            <button
                onClick={onPrev}
                className="w-5 h-5 flex items-center justify-center rounded-full text-text-secondary hover:text-primary active:text-primary transition-colors"
            >
                <ChevronLeft size={14} strokeWidth={2.5} />
            </button>
            {/* Week/month scope owns the rangeLabel text — picker here is presets-only
                (no onChange ⇒ DatePicker hides the grid, shows just the quick chips). */}
            <DatePicker
                onPresetSelect={onPresetSelect}
                trigger={chipTrigger({ labelOverride: rangeLabel })}
            />
            <button
                onClick={() => canGoForward && onNext()}
                className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canGoForward ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
            >
                <ChevronRight size={14} strokeWidth={2.5} />
            </button>
        </div>
    )
}
