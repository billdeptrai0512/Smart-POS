// Unified day + custom-range date control via DatePicker (range mode).
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import HistoryTabsBar from './HistoryTabsBar'
import DatePicker, { type DateRange } from '../common/DatePicker'
import { formatIsoShort, formatIsoDisplay, type PresetRange } from '../common/datePickerUtils'
import { onboardingHintClass } from '../../utils/onboardingHint'
import { ICON_BTN } from '../common/ModalShell'

interface DateRangePickerProps {
    scope: string
    rangeLabel?: string
    rangeStartISO?: string | null
    rangeEndISO?: string | null
    dayInputValue: string
    customRange?: DateRange | null
    todayISO: string
    canGoForwardDay?: boolean
    canGoForward?: boolean
    canShiftRangeForward?: boolean
    onPrevDay?: () => void
    onNextDay?: () => void
    onOffsetPrev?: () => void
    onOffsetNext?: () => void
    // ‹ › của scope custom dịch cả cửa sổ theo bề rộng của nó.
    onShiftRange?: (direction: -1 | 1) => void
    onRangeChange: (range: DateRange) => void
    onPresetSelect?: (preset: PresetRange) => void
}

interface HistoryHeaderProps extends DateRangePickerProps {
    title?: string
    totalCups?: number
    isReadOnly?: boolean
    onBack: () => void
    onForward: () => void
    hintForward?: boolean
    activeTab?: string
    onTabSelect?: (key: string) => void
    hintTab?: string | null
    belowTabs?: ReactNode
}

// Tabs row (activeTab) bỏ qua khi không truyền — trang Báo cáo dùng belowTabs thay thế (DailyReportPage:
// hàng lọc Dòng tiền / Kiểm kê / Lợi nhuận). Phần còn lại (`picker`) là props của DateRangePicker.
export default function HistoryHeader({
    title = 'Nhật ký', totalCups, isReadOnly,
    onBack, onForward, hintForward = false,
    activeTab, onTabSelect, hintTab, belowTabs,
    ...picker
}: HistoryHeaderProps) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className={ICON_BTN}
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1">{title}</span>
                    {!isReadOnly ? (
                        <DateRangePicker {...picker} />
                    ) : (
                        <span className="text-[12px] font-bold text-text/80 leading-none tabular-nums">{totalCups} ly</span>
                    )}
                </div>

                <button
                    onClick={onForward}
                    className={`${ICON_BTN} ${onboardingHintClass(hintForward)}`}
                >
                    <ArrowRight size={20} strokeWidth={2.5} />
                </button>
            </div>

            {activeTab && <HistoryTabsBar activeTab={activeTab} onSelect={onTabSelect} hintTab={hintTab} />}
            {belowTabs}
        </header>
    )
}

// One calendar control for ALL scopes. The grid always renders (range mode) with
// the current selection highlighted; chevrons + chip label adapt per scope:
//   • day    → chip dd/mm/yyyy, chevrons step ±1 day, picking 2 days → custom.
//   • week   → chip + highlight the week range, chevrons step ±1 week (offset),
//              "Tuần này" preset chip shown active.
//   • month  → same as week but ±1 month, "Tháng này" active.
//   • custom → chip dd/mm–dd/mm, chevrons shift the window by its own width.
export function DateRangePicker({
    scope, rangeLabel, rangeStartISO, rangeEndISO,
    dayInputValue, customRange, todayISO,
    canGoForwardDay, canGoForward, canShiftRangeForward,
    onPrevDay, onNextDay, onOffsetPrev, onOffsetNext, onShiftRange,
    onRangeChange, onPresetSelect,
}: DateRangePickerProps) {
    const isDay = scope === 'day'
    const isPeriod = scope === 'week' || scope === 'month'

    // Calendar selection to highlight: day = zero-width range; week/month = the
    // period's ISO bounds; custom = the user's range.
    const value = isDay
        ? { startISO: dayInputValue, endISO: dayInputValue }
        : isPeriod
            ? (rangeStartISO && rangeEndISO ? { startISO: rangeStartISO, endISO: rangeEndISO } : null)
            : (customRange?.startISO ? customRange : null)

    // Chip label per scope.
    const label = isDay
        ? formatIsoDisplay(dayInputValue)
        : isPeriod
            ? rangeLabel
            : (value ? `${formatIsoShort(value.startISO)} – ${formatIsoShort(value.endISO)}` : 'Chọn ngày')

    // Chevron behaviour per scope.
    const onPrev = isDay ? onPrevDay : isPeriod ? onOffsetPrev : () => onShiftRange?.(-1)
    const onNext = isDay ? onNextDay : isPeriod ? onOffsetNext : () => onShiftRange?.(1)
    const canForward = isDay ? canGoForwardDay : isPeriod ? canGoForward : canShiftRangeForward

    // Active preset chip (so week/month show the toggle focus).
    const activePresetKey = isPeriod ? scope : (isDay && dayInputValue === todayISO ? 'today' : undefined)

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
                activePresetKey={activePresetKey}
                trigger={(pickerLabel, toggle) => (
                    <button
                        type="button"
                        onClick={toggle}
                        className="text-[12px] font-bold text-text/80 leading-none tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4"
                    >
                        {label ?? pickerLabel}
                    </button>
                )}
            />
            <button
                onClick={() => canForward && onNext?.()}
                className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${canForward ? 'text-text-secondary hover:text-primary active:text-primary' : 'text-text-dim opacity-30 cursor-default'}`}
            >
                <ChevronRight size={14} strokeWidth={2.5} />
            </button>
        </div>
    )
}
