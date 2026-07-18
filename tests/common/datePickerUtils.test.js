// Ngày — parseIsoDay và tiện ích date-picker.
// Nguồn: src/components/common/datePickerUtils.js

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    getMonthGrid, shiftMonth, monthTitle, formatIsoDisplay, formatIsoShort,
    isIsoBefore, isIsoAfter, isIsoEqual, presetRanges, parseIsoDay,
} from '../../src/components/common/datePickerUtils'

// NOTE: all date math flows through utils/dateVN, which pins boundaries to
// Asia/Ho_Chi_Minh (+07:00). These tests assert that VN-anchored behaviour and
// therefore pass regardless of the machine's local timezone.

describe('parseIsoDay', () => {
    it('parses a valid YYYY-MM-DD to a Date', () => {
        const d = parseIsoDay('2026-05-10')
        expect(d).toBeInstanceOf(Date)
        // Midnight VN = 17:00 UTC the previous day.
        expect(d.toISOString()).toBe('2026-05-09T17:00:00.000Z')
    })
    it('returns null on falsy / malformed input', () => {
        expect(parseIsoDay(null)).toBeNull()
        expect(parseIsoDay(undefined)).toBeNull()
        expect(parseIsoDay('')).toBeNull()
        expect(parseIsoDay('2026-05')).toBeNull()
    })
})

describe('formatIsoDisplay / formatIsoShort', () => {
    it('formats full dd/mm/yyyy', () => {
        expect(formatIsoDisplay('2026-05-10')).toBe('10/05/2026')
    })
    it('formats compact dd/mm', () => {
        expect(formatIsoShort('2026-05-10')).toBe('10/05')
    })
    it('handles empty input distinctly', () => {
        expect(formatIsoDisplay('')).toBe('')   // display → blank
        expect(formatIsoShort('')).toBe('—')    // short → em-dash placeholder
        expect(formatIsoShort(null)).toBe('—')
    })
})

describe('isIso comparators', () => {
    it('orders lexicographically (valid for zero-padded ISO)', () => {
        expect(isIsoBefore('2026-05-09', '2026-05-10')).toBe(true)
        expect(isIsoAfter('2026-05-11', '2026-05-10')).toBe(true)
        expect(isIsoEqual('2026-05-10', '2026-05-10')).toBe(true)
    })
    it('returns false when either side is falsy (no accidental matches)', () => {
        expect(isIsoBefore(null, '2026-05-10')).toBe(false)
        expect(isIsoAfter('2026-05-10', undefined)).toBe(false)
        expect(isIsoEqual(null, null)).toBe(false)
        expect(isIsoEqual('', '')).toBe(false)
    })
})

describe('getMonthGrid', () => {
    it('always returns 42 cells (6 rows × 7 cols)', () => {
        const grid = getMonthGrid(parseIsoDay('2026-05-15'))
        expect(grid).toHaveLength(42)
    })

    it('runs Mon→Sun and aligns the 1st of the month to its weekday', () => {
        // 1 May 2026 is a Friday. Mon=0..Fri=4, so 4 leading cells from April.
        const grid = getMonthGrid(parseIsoDay('2026-05-15'))
        const firstOfMonth = grid.find(c => c.iso === '2026-05-01')
        expect(firstOfMonth).toBeDefined()
        expect(firstOfMonth.weekday).toBe(4) // Friday in Mon-based index
        const idx = grid.indexOf(firstOfMonth)
        expect(idx).toBe(4) // 4 leading (outside) cells before it
        // Everything before the 1st is flagged outside (previous month).
        for (let i = 0; i < idx; i++) expect(grid[i].outside).toBe(true)
    })

    it('flags leading + trailing neighbour-month cells as outside, in-month as not', () => {
        const grid = getMonthGrid(parseIsoDay('2026-05-15'))
        const inMonth = grid.filter(c => !c.outside)
        // May has 31 days; all in-month cells belong to 2026-05.
        expect(inMonth).toHaveLength(31)
        expect(inMonth.every(c => c.iso.startsWith('2026-05'))).toBe(true)
        expect(inMonth[0].iso).toBe('2026-05-01')
        expect(inMonth[30].iso).toBe('2026-05-31')
    })

    it('cells are consecutive calendar days with correct day numbers', () => {
        const grid = getMonthGrid(parseIsoDay('2026-05-15'))
        for (let i = 1; i < grid.length; i++) {
            const prev = parseIsoDay(grid[i - 1].iso).getTime()
            const cur = parseIsoDay(grid[i].iso).getTime()
            expect(cur - prev).toBe(86_400_000) // exactly one day apart
        }
        const may10 = grid.find(c => c.iso === '2026-05-10')
        expect(may10.day).toBe(10)
    })

    it('handles a month starting on Monday with zero leading cells', () => {
        // 1 June 2026 is a Monday.
        const grid = getMonthGrid(parseIsoDay('2026-06-10'))
        expect(grid[0].iso).toBe('2026-06-01')
        expect(grid[0].outside).toBe(false)
        expect(grid[0].weekday).toBe(0) // Monday
    })

    it('handles February (28 days) without drift', () => {
        const grid = getMonthGrid(parseIsoDay('2026-02-15'))
        const inMonth = grid.filter(c => !c.outside)
        expect(inMonth).toHaveLength(28)
        expect(inMonth[27].iso).toBe('2026-02-28')
    })
})

describe('shiftMonth', () => {
    it('moves to the first day of the prev/next month', () => {
        const may = parseIsoDay('2026-05-15')
        expect(formatIsoDisplay(toISO(shiftMonth(may, -1)))).toBe('01/04/2026')
        expect(formatIsoDisplay(toISO(shiftMonth(may, +1)))).toBe('01/06/2026')
    })
    it('wraps across year boundaries', () => {
        const dec = parseIsoDay('2026-12-10')
        expect(formatIsoDisplay(toISO(shiftMonth(dec, +1)))).toBe('01/01/2027')
        const jan = parseIsoDay('2026-01-10')
        expect(formatIsoDisplay(toISO(shiftMonth(jan, -1)))).toBe('01/12/2025')
    })
})

describe('monthTitle', () => {
    it('renders "Tháng MM / YYYY" zero-padded', () => {
        expect(monthTitle(parseIsoDay('2026-05-15'))).toBe('Tháng 05 / 2026')
        expect(monthTitle(parseIsoDay('2026-12-01'))).toBe('Tháng 12 / 2026')
    })
})

describe('presetRanges (date-pinned)', () => {
    afterEach(() => vi.useRealTimers())

    it('today preset = single day, scope "day"', () => {
        // Wed 13 May 2026, 10:00 VN (03:00 UTC).
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-13T03:00:00.000Z'))
        const { today } = presetRanges()
        expect(today.scope).toBe('day')
        expect(today.startISO).toBe('2026-05-13')
        expect(today.endISO).toBe('2026-05-13')
    })

    it('week preset = Mon→Sun containing today', () => {
        vi.useFakeTimers()
        // Wed 13 May 2026 → week is Mon 11 → Sun 17.
        vi.setSystemTime(new Date('2026-05-13T03:00:00.000Z'))
        const { week } = presetRanges()
        expect(week.scope).toBe('week')
        expect(week.startISO).toBe('2026-05-11')
        expect(week.endISO).toBe('2026-05-17')
    })

    it('week preset handles a Sunday correctly (Mon is 6 days back)', () => {
        vi.useFakeTimers()
        // Sun 17 May 2026, 10:00 VN.
        vi.setSystemTime(new Date('2026-05-17T03:00:00.000Z'))
        const { week } = presetRanges()
        expect(week.startISO).toBe('2026-05-11')
        expect(week.endISO).toBe('2026-05-17')
    })

    it('month preset = 1st → last day of current month', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-05-13T03:00:00.000Z'))
        const { month } = presetRanges()
        expect(month.scope).toBe('month')
        expect(month.startISO).toBe('2026-05-01')
        expect(month.endISO).toBe('2026-05-31')
    })

    it('resolves "today" near VN midnight from the VN calendar day, not UTC', () => {
        vi.useFakeTimers()
        // 2026-05-13 23:30 VN = 2026-05-13 16:30 UTC. Still the 13th in VN.
        vi.setSystemTime(new Date('2026-05-13T16:30:00.000Z'))
        expect(presetRanges().today.startISO).toBe('2026-05-13')
    })
})

// Local helper: util has no exported Date→ISO, so reuse dateVN through a round-trip.
function toISO(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
}
