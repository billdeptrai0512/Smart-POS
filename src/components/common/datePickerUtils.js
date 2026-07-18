// Pure helpers for the custom DatePicker. All math goes through dateVN so VN
// timezone boundaries are correct regardless of where the browser is running.
//
// ISO strings here are always "YYYY-MM-DD" (VN day boundary), never full UTC ISO.

import { dateStringVN, startOfWeekVN, startOfMonthVN, endOfMonthVN, addDaysVN } from '../../utils/dateVN'

const MS_DAY = 86_400_000

// Parse "YYYY-MM-DD" → Date at VN midnight. Lenient: returns null on bad input.
function parseIsoDay(iso) {
    if (!iso || typeof iso !== 'string' || iso.length < 10) return null
    return new Date(`${iso.slice(0, 10)}T00:00:00+07:00`)
}

// Number of days in the calendar month containing `viewDate`.
function daysInMonth(viewDate) {
    const start = startOfMonthVN(viewDate)
    const end = endOfMonthVN(viewDate)
    return Math.round((end.getTime() - start.getTime() + 1) / MS_DAY)
}

// Build a 6-row × 7-col grid (always 42 cells) for the month containing `viewDate`.
// Grid runs Mon → Sun. Leading/trailing cells come from neighbour months and are
// flagged `outside` so the renderer can dim them.
//
// Returns: [{ iso, day, outside, weekday }] of length 42.
//   iso     — "YYYY-MM-DD"
//   day     — 1..31 (day-of-month number to render in the cell)
//   outside — true when cell belongs to previous/next month
//   weekday — 0=Mon..6=Sun
export function getMonthGrid(viewDate) {
    const monthStart = startOfMonthVN(viewDate)
    // Anchor to noon UTC so getUTCDay returns the VN weekday consistently.
    const dowFirst = new Date(`${dateStringVN(monthStart)}T12:00:00Z`).getUTCDay() // 0=Sun..6=Sat
    const leading = (dowFirst + 6) % 7 // Mon=0..Sun=6
    const gridStart = new Date(monthStart.getTime() - leading * MS_DAY)
    const thisMonthDays = daysInMonth(viewDate)
    const cells = []
    for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart.getTime() + i * MS_DAY)
        const iso = dateStringVN(d)
        const dayNum = Number(iso.slice(8, 10))
        const inThisMonth = i >= leading && i < leading + thisMonthDays
        cells.push({
            iso,
            day: dayNum,
            outside: !inThisMonth,
            weekday: i % 7,
        })
    }
    return cells
}

// Shift the view by ±N months. Used by the prev/next chevrons.
export function shiftMonth(viewDate, offset) {
    return startOfMonthVN(viewDate, offset)
}

// VN-aware "is this ISO before/after that ISO" — pure string compare works
// because we only ever pass "YYYY-MM-DD" strings, not full timestamps.
export function isIsoBefore(a, b) { return !!(a && b && a < b) }
export function isIsoAfter(a, b) { return !!(a && b && a > b) }
export function isIsoEqual(a, b) { return !!(a && b && a === b) }

// Preset range builders. Returns "YYYY-MM-DD" strings keyed for the scope system
// already in place on /history + /daily-report (day, week, month, custom).
//
// `today` is always derived from dateStringVN() at call time so a session that
// crosses midnight VN doesn't return yesterday's date.
export function presetRanges() {
    const todayISO = dateStringVN()
    const weekStart = startOfWeekVN()
    const weekEnd = addDaysVN(weekStart, 6)
    const monthStart = startOfMonthVN()
    const monthEnd = endOfMonthVN()
    return {
        today: { key: 'today', label: 'Hôm nay', scope: 'day',   startISO: todayISO,             endISO: todayISO },
        week:  { key: 'week',  label: 'Tuần này', scope: 'week',  startISO: dateStringVN(weekStart),  endISO: dateStringVN(weekEnd) },
        month: { key: 'month', label: 'Tháng này', scope: 'month', startISO: dateStringVN(monthStart), endISO: dateStringVN(monthEnd) },
    }
}

// Helper for the title bar — "Tháng 05 / 2026" in the user's locale tone.
export function monthTitle(viewDate) {
    const iso = dateStringVN(viewDate)
    const [y, m] = iso.split('-')
    return `Tháng ${m} / ${y}`
}

// Convert "YYYY-MM-DD" → "DD/MM/YYYY" for chip display.
export function formatIsoDisplay(iso) {
    if (!iso || iso.length < 10) return ''
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
}

// Convert "YYYY-MM-DD" → "DD/MM" (compact chip, e.g. range endpoints).
export function formatIsoShort(iso) {
    if (!iso || iso.length < 10) return '—'
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
}

export { parseIsoDay }
