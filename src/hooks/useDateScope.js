import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { dateStringVN } from '../utils/dateVN'
import { offsetFromISO, dayCustomDateOf } from '../utils/rangeCalc'

const MS_DAY = 86_400_000
const VALID_SCOPES = ['day', 'week', 'month', 'custom']

// Read a date selection out of URL search params. Returns null when there's no
// usable scope param, so callers can fall back to nav-state / defaults.
//   ?scope=week&offset=-1   ·   ?scope=custom&start=YYYY-MM-DD&end=YYYY-MM-DD
function readParamsSeed(sp) {
    const scope = sp.get('scope')
    if (!VALID_SCOPES.includes(scope)) return null
    if (scope === 'custom') {
        const startISO = sp.get('start')
        const endISO = sp.get('end')
        if (!startISO || !endISO) return null
        return { scope: 'custom', customRange: { startISO, endISO } }
    }
    const offset = Number(sp.get('offset'))
    return { scope, offset: Number.isFinite(offset) ? offset : 0 }
}

// Single owner of the dashboard's date selection, shared by /history and
// /daily-report so the two pages can never drift out of sync again (which is the
// bug class this hook exists to kill). Owns scope + offset + customRange +
// hasManualPick, plus every derived value and every transition handler the
// header date control needs.
//
// scope:
//   'day'    → a single VN day, addressed by `offset` (0 = today, −1 = yesterday…)
//   'week'   → Mon–Sun window, addressed by `offset` (0 = this week, −1 = last…)
//   'month'  → calendar month, addressed by `offset`
//   'custom' → an explicit { startISO, endISO } range in `customRange`
//
// `initial` seeds from nav state (location.state) so a window survives the
// Nhật ký ↔ Báo cáo tab switch. `hasManualPick` flags a calendar pick (vs chevron
// stepping) for callers that care.
export function useDateScope(initial) {
    const [searchParams, setSearchParams] = useSearchParams()

    // Initial state precedence: URL params (so refresh / shared links win) → nav
    // state (location.state, for the tab-switch hand-off) → defaults. `location.state`
    // is often null on direct nav, so guard rather than rely on a default param.
    const seed = readParamsSeed(searchParams) || initial || {}
    const initialScope = VALID_SCOPES.includes(seed.scope) ? seed.scope : 'day'
    const initialOffset = typeof seed.offset === 'number' ? seed.offset : 0
    const initialCustomRange = seed.customRange?.startISO ? seed.customRange : null

    const [scope, setScope] = useState(initialScope)
    const [offset, setOffset] = useState(initialOffset)
    const [customRange, setCustomRange] = useState(initialCustomRange)
    const [hasManualPick, setHasManualPick] = useState(false)

    // Mirror the live selection into the URL (replace, so it doesn't spam history).
    // Default day/offset-0 is the clean "no params" state. Other state survives a
    // refresh and makes the view shareable/bookmarkable.
    useEffect(() => {
        const next = new URLSearchParams(searchParams)
        // Clear any prior date params first.
        ;['scope', 'offset', 'start', 'end'].forEach(k => next.delete(k))
        if (scope === 'custom' && customRange?.startISO) {
            next.set('scope', 'custom')
            next.set('start', customRange.startISO)
            next.set('end', customRange.endISO)
        } else if (scope !== 'day' || offset !== 0) {
            next.set('scope', scope)
            if (offset !== 0) next.set('offset', String(offset))
        }
        // Only write if something actually changed (avoid a render loop).
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, offset, customRange])

    // Recomputed every render so a session crossing VN midnight sees the new day.
    const todayISO = dateStringVN()

    // Day-scope addressing: which single day is selected, and its calendar bounds.
    const dayCustomDate = useMemo(() => dayCustomDateOf(scope, offset), [scope, offset])
    const dayInputValue = dayCustomDate || todayISO
    const canGoForwardDay = dayInputValue < todayISO

    // ── helpers ──────────────────────────────────────────────────────────────
    const setOffsetFromISO = useCallback((iso) => {
        if (!iso || iso >= todayISO) { setOffset(0); setHasManualPick(false); return }
        setOffset(offsetFromISO(iso, todayISO))
    }, [todayISO])

    // Step the single-day selection by ±1 day. Clamps forward at today.
    const stepDay = useCallback((dir) => {
        setHasManualPick(false)
        const base = new Date(`${dayInputValue}T00:00:00+07:00`)
        const next = dateStringVN(new Date(base.getTime() + dir * MS_DAY))
        if (next >= todayISO) { setOffset(0); return }
        setOffsetFromISO(next)
    }, [dayInputValue, todayISO, setOffsetFromISO])

    const goPrevDay = useCallback(() => stepDay(-1), [stepDay])
    const goNextDay = useCallback(() => stepDay(+1), [stepDay])

    // Period (week/month) chevrons just move the offset.
    const goOffsetPrev = useCallback(() => setOffset(o => o - 1), [])
    const goOffsetNext = useCallback(() => setOffset(o => o + 1), [])
    const canGoForwardPeriod = offset < 0

    // The unified calendar emits { startISO, endISO }. Equal endpoints = single
    // day (→ day scope via offset); different = a real range (→ custom scope).
    // End is always clamped to today.
    const applyRange = useCallback(({ startISO, endISO }) => {
        if (!startISO || !endISO) return
        const safeEnd = endISO > todayISO ? todayISO : endISO
        const safeStart = startISO > safeEnd ? safeEnd : startISO
        if (safeStart === safeEnd) {
            setCustomRange(null)
            setScope('day')
            setHasManualPick(true)
            setOffsetFromISO(safeStart)
        } else {
            setCustomRange({ startISO: safeStart, endISO: safeEnd })
            setHasManualPick(false)
            setScope('custom')
        }
    }, [todayISO, setOffsetFromISO])

    // Shift the custom range by its own (inclusive) width. dir −1 earlier / +1
    // later; when a forward shift crosses today, the window is pinned to end at
    // today so the span stays constant.
    const shiftRange = useCallback((dir) => {
        if (scope !== 'custom' || !customRange?.startISO) return
        const start = new Date(`${customRange.startISO}T00:00:00+07:00`)
        const end = new Date(`${customRange.endISO}T00:00:00+07:00`)
        const spanDays = Math.round((end - start) / MS_DAY)
        let newStart = new Date(start.getTime() + dir * (spanDays + 1) * MS_DAY)
        let newEnd = new Date(end.getTime() + dir * (spanDays + 1) * MS_DAY)
        if (dir > 0 && dateStringVN(newEnd) > todayISO) {
            newEnd = new Date(`${todayISO}T00:00:00+07:00`)
            newStart = new Date(newEnd.getTime() - spanDays * MS_DAY)
        }
        setCustomRange({ startISO: dateStringVN(newStart), endISO: dateStringVN(newEnd) })
    }, [scope, customRange, todayISO])

    const canShiftRangeForward = scope === 'custom' && !!customRange?.endISO && customRange.endISO < todayISO

    // Jump to a specific past day (deep-link / "xem ngày X"). Resets to day scope.
    const goToDate = useCallback((iso) => {
        if (!iso) return
        setScope('day')
        setCustomRange(null)
        setHasManualPick(true)
        setOffsetFromISO(iso)
    }, [setOffsetFromISO])

    // Quick-preset chips (Hôm nay / Tuần này / Tháng này) + custom presets.
    const applyPreset = useCallback((preset) => {
        if (!preset) return
        if (preset.scope === 'custom') {
            setCustomRange({ startISO: preset.startISO, endISO: preset.endISO })
            setScope('custom')
        } else {
            setScope(preset.scope)
            setOffset(0)
            setCustomRange(null)
        }
        setHasManualPick(false)
    }, [])

    // The serialisable selection — pass into nav state so the other page rehydrates.
    const navState = useMemo(
        () => ({ scope, offset, customRange }),
        [scope, offset, customRange]
    )

    return {
        // state
        scope, offset, customRange, hasManualPick,
        // raw setters (still available for edge cases / callers that need them)
        setScope, setOffset, setCustomRange, setHasManualPick,
        // derived
        todayISO, dayCustomDate, dayInputValue,
        canGoForwardDay, canGoForwardPeriod, canShiftRangeForward,
        navState,
        // transitions
        goPrevDay, goNextDay, goOffsetPrev, goOffsetNext,
        applyRange, shiftRange, goToDate, applyPreset, setOffsetFromISO,
    }
}
