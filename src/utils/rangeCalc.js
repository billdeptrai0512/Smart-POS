// Shared "scope + offset + customRange → date range" math.
// Used by HistoryPage and DailyReportPage (previously duplicated).
//
// scope ∈ 'day' | 'week' | 'month' | 'custom'
// offset: negative for past, 0 = current period, only meaningful for day/week/month
// customRange?: { startISO, endISO } (YYYY-MM-DD in VN local)

import { startOfDayVN, endOfDayVN, dateStringVN } from './dateVN'
import { getDateRange } from '../components/DailyReportPage/ReportHeader'

const fmtDM = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

// Returns { start, end } for the given scope/offset/customRange.
export function calcRange(scope, offset, customRange) {
    if (scope === 'day') {
        const target = new Date()
        target.setDate(target.getDate() + offset)
        return { start: startOfDayVN(target), end: endOfDayVN(target) }
    }
    if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
        return {
            start: new Date(`${customRange.startISO}T00:00:00+07:00`),
            end: new Date(`${customRange.endISO}T23:59:59.999+07:00`),
        }
    }
    const { start, end } = getDateRange(scope, offset)
    return { start, end }
}

// Same as calcRange, plus a label "dd/mm" or "dd/mm – dd/mm" (year suffix on single-day).
export function calcRangeWithLabel(scope, offset, customRange) {
    const { start, end } = calcRange(scope, offset, customRange)
    const label = scope === 'day'
        ? `${fmtDM(start)}/${start.getFullYear()}`
        : `${fmtDM(start)} – ${fmtDM(end)}`
    return { start, end, label }
}

// Adds previous-period boundaries for comparison reports.
// For custom ranges, prev period = same length immediately before.
export function calcRangeWithPrev(scope, offset, customRange) {
    const { start, end } = calcRange(scope, offset, customRange)
    if (scope === 'day') {
        const pStart = new Date(start); pStart.setDate(pStart.getDate() - 1)
        const pEnd = new Date(end); pEnd.setDate(pEnd.getDate() - 1)
        return { start, end, prevStart: pStart, prevEnd: pEnd }
    }
    if (scope === 'custom' && customRange?.startISO && customRange?.endISO) {
        const diff = end.getTime() - start.getTime()
        return {
            start, end,
            prevStart: new Date(start.getTime() - diff - 86400000),
            prevEnd: new Date(end.getTime() - diff - 86400000),
        }
    }
    const { start: pStart, end: pEnd } = getDateRange(scope, offset - 1)
    return { start, end, prevStart: pStart, prevEnd: pEnd }
}

// Convert an ISO date (YYYY-MM-DD VN local) into an offset relative to "today VN".
// Returns 0 if iso is today or in the future (caller uses this to snap back to current).
export function offsetFromISO(iso, todayISO) {
    if (!iso || iso >= todayISO) return 0
    const target = new Date(`${iso}T00:00:00+07:00`)
    const today = startOfDayVN()
    return Math.round((target - today) / 86400000)
}

// "Day mode": ISO of the offset day, or null if scope/offset means "today".
export function dayCustomDateOf(scope, offset) {
    if (scope !== 'day' || offset === 0) return null
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return dateStringVN(d)
}
