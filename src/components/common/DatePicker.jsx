import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dateStringVN } from '../../utils/dateVN'
import {
    getMonthGrid, shiftMonth, monthTitle, formatIsoDisplay, formatIsoShort,
    isIsoBefore, isIsoAfter, isIsoEqual, presetRanges, parseIsoDay,
} from './datePickerUtils'

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

// Popover calendar. Anchored to its trigger by being rendered as a sibling
// absolutely-positioned panel — caller wraps the trigger + DatePicker in a
// `relative` parent. Closes on outside click, ESC, or after a selection.
//
// Two modes:
//   • single (default): `value` is "YYYY-MM-DD"; onChange(iso) per pick.
//   • range (`range`):  `value` is { startISO, endISO } | null. First tap sets
//     the start, second tap completes the range (auto-swapped if reversed) and
//     fires onChange({ startISO, endISO }). In-between days are tinted.
//
// Props:
//   value          single: "YYYY-MM-DD"|null · range: { startISO, endISO }|null
//   max / min      "YYYY-MM-DD" bounds; out-of-range cells render disabled.
//   onChange       single: (iso)=>void · range: ({startISO,endISO})=>void.
//                  Omit to hide the grid entirely (presets-only popover).
//   onPresetSelect (preset)=>void — fired when a quick-preset chip is tapped.
//   presets        boolean — show the built-in Hôm nay/Tuần này/Tháng này row.
//   extraPresets   [{ key, label, onClick }] — optional caller chips appended to
//                  the preset row (generic; unused by the header today).
//   range          boolean — enable two-tap range selection.
//   trigger        (label, toggle) => ReactNode — the chip/button that opens it.
//   align          'center' | 'start' | 'end' — popover horizontal alignment.
//   anchor         'self' (default) | 'parent' — 'parent' bỏ `relative` trên wrapper
//                  để popover neo vào positioned ancestor gần nhất của CALLER
//                  (vd: cả row form) thay vì chỉ cái nút trigger.
export default function DatePicker({
    value,
    max,
    min,
    onChange,
    onPresetSelect,
    presets = true,
    extraPresets = [],
    activePresetKey,   // highlight the matching quick-preset chip (e.g. 'week' | 'month' | 'today')
    range = false,
    trigger,
    align = 'center',
    anchor = 'self',
}) {
    const [open, setOpen] = useState(false)
    const anchorIso = range ? value?.startISO : value
    const [viewMonth, setViewMonth] = useState(() => parseIsoDay(anchorIso) || new Date())
    // Range build state: the first-tapped endpoint awaiting its pair.
    const [pendingStart, setPendingStart] = useState(null)
    const wrapRef = useRef(null)

    const dayPickEnabled = typeof onChange === 'function'

    // Re-anchor month + reset any in-progress range each time the popover opens.
    // Intentional state-sync on the `open` edge — not a cascading-render hazard.
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (open) {
            setViewMonth(parseIsoDay(anchorIso) || new Date())
            setPendingStart(null)
        }
    }, [open, anchorIso])
    /* eslint-enable react-hooks/set-state-in-effect */

    // Outside click + Escape close — listeners only live while open.
    useEffect(() => {
        if (!open) return
        const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('mousedown', onDown)
        window.addEventListener('touchstart', onDown)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('mousedown', onDown)
            window.removeEventListener('touchstart', onDown)
            window.removeEventListener('keydown', onKey)
        }
    }, [open])

    // todayISO + presets re-derive on open so a terminal left past VN midnight
    // doesn't keep highlighting yesterday or hand back a stale "Hôm nay" range.
    const todayISO = useMemo(() => dateStringVN(), [open])
    const grid = useMemo(() => getMonthGrid(viewMonth), [viewMonth])
    const presetList = useMemo(() => (presets ? Object.values(presetRanges()) : []), [presets, open])

    const handlePick = (iso, disabled) => {
        if (disabled || !dayPickEnabled) return
        if (!range) {
            onChange(iso)
            setOpen(false)
            return
        }
        // Range mode, two-tap: first tap arms the start, second tap commits.
        // Tapping the SAME day twice → start === end → caller treats it as a
        // single-day selection; two different days → a real range.
        if (!pendingStart) {
            setPendingStart(iso)
            return
        }
        const [startISO, endISO] = isIsoBefore(iso, pendingStart) ? [iso, pendingStart] : [pendingStart, iso]
        onChange({ startISO, endISO })
        setPendingStart(null)
        setOpen(false)
    }

    const handlePreset = (preset) => {
        onPresetSelect?.(preset)
        setOpen(false)
    }

    // Active range bounds for cell tinting: prefer the in-progress pendingStart
    // (single endpoint, no fill), else the committed value range.
    const rangeStart = range ? (pendingStart || value?.startISO) : null
    const rangeEnd = range && !pendingStart ? value?.endISO : null

    const cellTone = (iso) => {
        if (range) {
            if (isIsoEqual(iso, rangeStart) || isIsoEqual(iso, rangeEnd)) return 'endpoint'
            if (rangeStart && rangeEnd && isIsoAfter(iso, rangeStart) && isIsoBefore(iso, rangeEnd)) return 'inside'
            return null
        }
        return isIsoEqual(iso, value) ? 'endpoint' : null
    }

    const displayLabel = range
        ? (value?.startISO ? `${formatIsoShort(value.startISO)} – ${formatIsoShort(value.endISO)}` : '—')
        : (value ? formatIsoDisplay(value) : '—')
    const toggle = () => setOpen(o => !o)
    const alignCls = align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'

    return (
        <div ref={wrapRef} className={`${anchor === 'self' ? 'relative ' : ''}inline-flex`}>
            {trigger
                ? trigger(displayLabel, toggle)
                : (
                    <button
                        type="button"
                        onClick={toggle}
                        className="text-[12px] font-bold text-text/80 tabular-nums underline decoration-dashed decoration-primary/40 underline-offset-4"
                    >
                        {displayLabel}
                    </button>
                )
            }

            {open && (
                <div
                    className={`absolute top-full mt-2 ${alignCls} z-50 bg-surface border border-border/60 rounded-[16px] shadow-2xl p-3 w-[280px] max-w-[calc(100vw-1.5rem)]`}
                    onClick={(e) => e.stopPropagation()}
                >
                    {dayPickEnabled && (
                        <>
                            {/* Header — month nav */}
                            <div className="flex items-center justify-between mb-2">
                                <button
                                    type="button"
                                    onClick={() => setViewMonth(m => shiftMonth(m, -1))}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:text-primary hover:bg-surface-light transition-colors"
                                    aria-label="Tháng trước"
                                >
                                    <ChevronLeft size={16} strokeWidth={2.5} />
                                </button>
                                <span className="text-[12px] font-black text-text uppercase tracking-wide tabular-nums">
                                    {monthTitle(viewMonth)}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setViewMonth(m => shiftMonth(m, 1))}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:text-primary hover:bg-surface-light transition-colors"
                                    aria-label="Tháng sau"
                                >
                                    <ChevronRight size={16} strokeWidth={2.5} />
                                </button>
                            </div>

                            {/* Range hint while waiting for the second tap */}
                            {range && pendingStart && (
                                <div className="mb-2 text-center text-[10px] font-bold text-primary">
                                    Chọn ngày kết thúc · chạm lại {formatIsoShort(pendingStart)} nếu chỉ 1 ngày
                                </div>
                            )}

                            {/* Weekday header */}
                            <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {WEEKDAY_LABELS.map(w => (
                                    <div key={w} className="text-[10px] font-black text-text-dim text-center py-1">{w}</div>
                                ))}
                            </div>

                            {/* Day grid */}
                            <div className="grid grid-cols-7 gap-y-0.5">
                                {grid.map((cell) => {
                                    const isToday = isIsoEqual(cell.iso, todayISO)
                                    const disabled = (!!max && isIsoAfter(cell.iso, max)) || (!!min && isIsoBefore(cell.iso, min))
                                    const tone = cellTone(cell.iso)
                                    const base = 'h-8 w-full flex items-center justify-center text-[12px] font-bold tabular-nums transition-colors'
                                    const state =
                                        disabled         ? 'text-text-dim/30 cursor-not-allowed rounded-lg'
                                      : tone === 'endpoint' ? 'bg-primary text-black rounded-lg'
                                      : tone === 'inside'   ? 'bg-primary/15 text-text'
                                      : isToday          ? 'ring-1 ring-primary/60 text-primary hover:bg-primary/10 rounded-lg'
                                      : cell.outside     ? 'text-text-dim/50 hover:bg-surface-light rounded-lg'
                                      :                    'text-text hover:bg-surface-light rounded-lg'
                                    return (
                                        <button
                                            key={cell.iso}
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => handlePick(cell.iso, disabled)}
                                            aria-current={isToday ? 'date' : undefined}
                                            className={`${base} ${state}`}
                                        >
                                            {cell.day}
                                        </button>
                                    )
                                })}
                            </div>
                        </>
                    )}

                    {/* Presets — full-width grid so chips fill the popover evenly */}
                    {(presetList.length > 0 || extraPresets.length > 0) && (
                        <>
                            {dayPickEnabled && (
                                <div className="flex items-center gap-2 mt-3 mb-2">
                                    <div className="flex-1 h-[1px] bg-border/60" />
                                    <span className="text-[9px] font-black text-text-dim uppercase tracking-widest">Chọn nhanh</span>
                                    <div className="flex-1 h-[1px] bg-border/60" />
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-1.5">
                                {presetList.map(p => {
                                    const active = p.key === activePresetKey
                                    return (
                                        <button
                                            key={p.key}
                                            type="button"
                                            onClick={() => handlePreset(p)}
                                            className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold text-center transition-colors ${
                                                active
                                                    ? 'bg-primary text-black border-primary'
                                                    : 'bg-surface-light border-border/60 text-text-secondary hover:bg-primary/10 hover:text-primary hover:border-primary/40'
                                            }`}
                                        >
                                            {p.label}
                                        </button>
                                    )
                                })}
                                {extraPresets.map(p => (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() => { p.onClick?.(); setOpen(false) }}
                                        className="px-2 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-[11px] font-bold text-primary text-center hover:bg-primary/20 transition-colors"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
