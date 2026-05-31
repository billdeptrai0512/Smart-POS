import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dateStringVN } from '../../utils/dateVN'
import {
    getMonthGrid, shiftMonth, monthTitle, formatIsoDisplay,
    isIsoBefore, isIsoAfter, isIsoEqual, presetRanges, parseIsoDay,
} from './datePickerUtils'

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

// Single-date popover calendar. Anchored to its trigger by being rendered as a
// sibling absolutely-positioned panel — caller wraps the trigger + DatePicker
// in a `relative` parent. Closes on outside click, ESC, or after a selection.
//
// Props:
//   value          "YYYY-MM-DD" string of the currently selected day (or null).
//   max / min      "YYYY-MM-DD" bounds; out-of-range cells render disabled.
//   onChange       (iso) => void — fired when user picks a day. When omitted the
//                  grid is hidden and the popover shows ONLY the preset chips
//                  (used by week/month scope where a single day pick is meaningless).
//   onPresetSelect (preset) => void — fired when user taps a preset chip.
//                  preset = { key, label, scope, startISO, endISO }.
//   presets        boolean — show the bottom preset row (default true).
//   trigger        (label, toggle) => ReactNode — the chip/button that opens the panel.
//   align          'center' | 'start' | 'end' — popover horizontal alignment.
//
// State is just `viewMonth` (which grid page is showing) + `open`. The selected
// value is fully controlled by `value`.
export default function DatePicker({
    value,
    max,
    min,
    onChange,
    onPresetSelect,
    presets = true,
    trigger,
    align = 'center',
}) {
    const [open, setOpen] = useState(false)
    const [viewMonth, setViewMonth] = useState(() => parseIsoDay(value) || new Date())
    const wrapRef = useRef(null)

    const dayPickEnabled = typeof onChange === 'function'

    // Re-anchor view month each time the popover opens so it lands on the
    // selected value's month rather than wherever the user last paged to.
    useEffect(() => {
        if (open) setViewMonth(parseIsoDay(value) || new Date())
    }, [open, value])

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

    // todayISO + presets re-derive each time the popover opens, so a POS terminal
    // left running past VN midnight doesn't keep highlighting yesterday or hand
    // back a stale "Hôm nay" range. Keyed on `open` (cheap; popover renders once).
    const todayISO = useMemo(() => dateStringVN(), [open])
    const grid = useMemo(() => getMonthGrid(viewMonth), [viewMonth])
    const presetList = useMemo(() => (presets ? Object.values(presetRanges()) : []), [presets, open])

    const handlePick = (iso, disabled) => {
        if (disabled || !dayPickEnabled) return
        onChange(iso)
        setOpen(false)
    }

    const handlePreset = (preset) => {
        onPresetSelect?.(preset)
        setOpen(false)
    }

    const displayLabel = value ? formatIsoDisplay(value) : '—'
    const toggle = () => setOpen(o => !o)
    const alignCls = align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'

    return (
        <div ref={wrapRef} className="relative inline-flex">
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
                    className={`absolute top-full mt-2 ${alignCls} z-50 bg-surface border border-border/60 rounded-[16px] shadow-2xl p-3 w-[280px] max-w-[calc(100vw-1rem)]`}
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

                            {/* Weekday header */}
                            <div className="grid grid-cols-7 gap-0.5 mb-1">
                                {WEEKDAY_LABELS.map(w => (
                                    <div key={w} className="text-[10px] font-black text-text-dim text-center py-1">{w}</div>
                                ))}
                            </div>

                            {/* Day grid */}
                            <div className="grid grid-cols-7 gap-0.5">
                                {grid.map((cell) => {
                                    const isToday = isIsoEqual(cell.iso, todayISO)
                                    const isSelected = isIsoEqual(cell.iso, value)
                                    const disabled = (!!max && isIsoAfter(cell.iso, max)) || (!!min && isIsoBefore(cell.iso, min))
                                    const base = 'h-8 w-full flex items-center justify-center rounded-lg text-[12px] font-bold tabular-nums transition-colors'
                                    const state =
                                        disabled    ? 'text-text-dim/30 cursor-not-allowed'
                                      : isSelected  ? 'bg-primary text-black'
                                      : isToday     ? 'ring-1 ring-primary/60 text-primary hover:bg-primary/10'
                                      : cell.outside? 'text-text-dim/50 hover:bg-surface-light'
                                      :               'text-text hover:bg-surface-light'
                                    return (
                                        <button
                                            key={cell.iso}
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => handlePick(cell.iso, disabled)}
                                            aria-current={isToday ? 'date' : undefined}
                                            aria-pressed={isSelected}
                                            className={`${base} ${state}`}
                                        >
                                            {cell.day}
                                        </button>
                                    )
                                })}
                            </div>
                        </>
                    )}

                    {/* Presets */}
                    {presets && presetList.length > 0 && (
                        <>
                            {dayPickEnabled && (
                                <div className="flex items-center gap-2 mt-3 mb-2">
                                    <div className="flex-1 h-[1px] bg-border/60" />
                                    <span className="text-[9px] font-black text-text-dim uppercase tracking-widest">Chọn nhanh</span>
                                    <div className="flex-1 h-[1px] bg-border/60" />
                                </div>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                                {presetList.map(p => (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() => handlePreset(p)}
                                        className="px-2.5 py-1 rounded-lg bg-surface-light border border-border/60 text-[11px] font-bold text-text-secondary hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors"
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
