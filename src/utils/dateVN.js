// Vietnam timezone helpers. The app and the Postgres DB live in different timezones
// (browser local vs UTC), so any "today" boundary computed via browser-local
// `setHours(0,0,0,0)` or `toDateString()` drifts whenever the runtime isn't Asia/Ho_Chi_Minh.
//
// All date boundaries used for filtering / fetching / reporting MUST go through
// these helpers so the semantics stay consistent regardless of where the code
// runs (laptop in HCMC, server in UTC, future client in another TZ).

const VN_TZ = 'Asia/Ho_Chi_Minh'

// "YYYY-MM-DD" string in Vietnam timezone for the given Date (defaults to now).
// Uses 'en-CA' locale which always formats as ISO yyyy-mm-dd regardless of system locale.
export function dateStringVN(date = new Date()) {
    return date.toLocaleDateString('en-CA', { timeZone: VN_TZ })
}

// "HH:mm" (24h) string in Vietnam timezone for the given Date (defaults to now).
export function timeStringVN(date = new Date()) {
    return date.toLocaleTimeString('en-GB', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

// "dd/mm" in Vietnam timezone. Built on dateStringVN instead of Date#getDate()/
// getMonth() (browser-local) so display stays correct if the runtime TZ isn't VN.
export function dateShortVN(date = new Date()) {
    const [, m, d] = dateStringVN(date).split('-')
    return `${d}/${m}`
}

// "dd/mm/yyyy" in Vietnam timezone.
export function dateFullVN(date = new Date()) {
    const [y] = dateStringVN(date).split('-')
    return `${dateShortVN(date)}/${y}`
}

// Start of "today in Vietnam" — i.e. 00:00:00.000 local VN time, as a UTC-aware Date.
// Equivalent to: midnight in VN expressed in absolute time.
//   At 02:00 VN on 2026-05-18 (= 19:00 UTC on 2026-05-17):
//     startOfDayVN() → 2026-05-18 00:00:00 +07:00 = 2026-05-17 17:00:00 UTC
export function startOfDayVN(date = new Date()) {
    return new Date(`${dateStringVN(date)}T00:00:00+07:00`)
}

// End of "today in Vietnam" — 23:59:59.999 local VN time.
export function endOfDayVN(date = new Date()) {
    return new Date(`${dateStringVN(date)}T23:59:59.999+07:00`)
}

// Compare two dates for "same day in Vietnam". Replaces toDateString() equality
// (which depends on browser TZ and would compare wrong dates near midnight).
export function isSameDayVN(d1, d2) {
    return dateStringVN(new Date(d1)) === dateStringVN(new Date(d2))
}

// Add (or subtract) days from a date, anchored to VN midnight.
export function addDaysVN(date, days) {
    const start = startOfDayVN(date)
    return new Date(start.getTime() + days * 86_400_000)
}

// Start of "this week in VN" — Monday 00:00:00.000 VN.
export function startOfWeekVN(date = new Date()) {
    const todayVN = startOfDayVN(date)
    // Noon-UTC anchor of the VN date guarantees the same weekday everywhere.
    const dow = new Date(`${dateStringVN(date)}T12:00:00Z`).getUTCDay() // 0=Sun..6=Sat
    const mondayOffset = (dow + 6) % 7 // Mon=0..Sun=6
    return new Date(todayVN.getTime() - mondayOffset * 86_400_000)
}

// Start of "month X+offset in VN" — day 1, 00:00:00.000 VN.
export function startOfMonthVN(date = new Date(), offset = 0) {
    const [y, m] = dateStringVN(date).split('-').map(Number)
    const targetMonth0 = m - 1 + offset // 0-based
    const targetYear = y + Math.floor(targetMonth0 / 12)
    const normalizedMonth = ((targetMonth0 % 12) + 12) % 12 + 1
    return new Date(`${targetYear}-${String(normalizedMonth).padStart(2, '0')}-01T00:00:00+07:00`)
}

// End of "month X" — last millisecond before next month's start.
export function endOfMonthVN(date = new Date(), offset = 0) {
    return new Date(startOfMonthVN(date, offset + 1).getTime() - 1)
}
