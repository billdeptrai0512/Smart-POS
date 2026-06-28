import { useState, useEffect, useMemo } from 'react'
import { fetchDailyReportContext, fetchReportByDate, fetchReportByRange } from '../services/orderService'
import { dateStringVN } from '../utils/dateVN'
import { calcRangeWithPrev } from '../utils/rangeCalc'
import { dedupeShiftClosingsByDay } from '../utils/reportStats'

/**
 * useDailyReportData
 * ------------------
 * Owns all server-data state for /daily-report and dispatches the right
 * fetcher per scope:
 *   - today              → fetchDailyReportContext
 *   - past single day    → fetchReportByDate
 *   - week/month/custom  → fetchReportByRange (with prev period for compare)
 *
 * Also owns `todayISO` (VN-local) so a tab left open across midnight detects
 * the rollover on focus and refetches with the new day.
 *
 * `setShiftClosing` is returned so save handlers (cashflow, inventory) can
 * patch the closing in place after a successful write, avoiding a round-trip
 * refetch just to update one field.
 */
export function useDailyReportData({ addressId, scope, offset, customRange, onError }) {
    const [shiftClosing, setShiftClosing] = useState(null)
    const [yesterdayClosing, setYesterdayClosing] = useState(null)
    const [yesterdayOrders, setYesterdayOrders] = useState([])
    const [yesterdayExpensesData, setYesterdayExpensesData] = useState([])
    const [isAsyncReady, setIsAsyncReady] = useState(false)
    const [apiOrders, setApiOrders] = useState([])
    const [apiExpenses, setApiExpenses] = useState([])
    // apiPayments mirrors target_payments / today_payments — driver của refill cashflow
    // (theo paid_at). todayPayments tách riêng vì today scope không set apiExpenses.
    const [apiPayments, setApiPayments] = useState([])
    const [todayPayments, setTodayPayments] = useState([])
    const [apiShiftClosings, setApiShiftClosings] = useState([])
    const [prevShiftClosings, setPrevShiftClosings] = useState([])

    // `todayISO` is state (not per-render) so an overnight tab can detect the date
    // change on focus/visibility and trigger a refetch of shift_closing + clear stale
    // cash + inventory inputs.
    const [todayISO, setTodayISO] = useState(() => dateStringVN(new Date()))
    useEffect(() => {
        const check = () => {
            const now = dateStringVN(new Date())
            if (now !== todayISO) setTodayISO(now)
        }
        const onVis = () => { if (document.visibilityState === 'visible') check() }
        window.addEventListener('focus', check)
        document.addEventListener('visibilitychange', onVis)
        return () => {
            window.removeEventListener('focus', check)
            document.removeEventListener('visibilitychange', onVis)
        }
    }, [todayISO])

    const { rangeStart, rangeEnd, prevStart, prevEnd } = useMemo(() => {
        const { start, end, prevStart: pStart, prevEnd: pEnd } = calcRangeWithPrev(scope, offset, customRange)
        return { rangeStart: start, rangeEnd: end, prevStart: pStart, prevEnd: pEnd }
    }, [scope, offset, customRange])

    const isTodayScope = scope === 'day' && offset === 0

    useEffect(() => {
        if (!addressId) return

        setIsAsyncReady(false)
        if (isTodayScope) {
            fetchDailyReportContext(addressId)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setYesterdayOrders(data?.yesterday_orders || [])
                    setYesterdayExpensesData(data?.yesterday_expenses || [])
                    setTodayPayments(data?.target_payments || [])
                })
                .catch((error) => onError?.(error, 'Tải báo cáo hôm nay'))
                .finally(() => setIsAsyncReady(true))
        } else if (scope === 'day') {
            const targetDateStr = dateStringVN(rangeStart)
            fetchReportByDate(addressId, targetDateStr)
                .then((data) => {
                    setShiftClosing(data?.shift_closing || null)
                    setYesterdayClosing(data?.yesterday_closing || null)
                    setYesterdayOrders(data?.yesterday_orders || [])
                    setYesterdayExpensesData(data?.yesterday_expenses || [])
                    setApiOrders(data?.target_orders || [])
                    setApiExpenses(data?.target_expenses || [])
                    setApiPayments(data?.target_payments || [])
                })
                .catch((error) => onError?.(error, `Tải báo cáo ngày ${targetDateStr}`))
                .finally(() => setIsAsyncReady(true))
        } else {
            // Range scopes (week/month/custom)
            fetchReportByRange(addressId, rangeStart.toISOString(), rangeEnd.toISOString(), prevStart.toISOString(), prevEnd.toISOString())
                .then((data) => {
                    // Khử trùng phiếu chốt về 1 phiếu mới nhất/ngày VN — khớp report Ngày,
                    // tránh double-count Thực thu/hao hụt ở Tuần/Tháng (xem dedupeShiftClosingsByDay).
                    const targetClosings = dedupeShiftClosingsByDay(data?.target_shift_closings || [])
                    setApiOrders(data?.target_orders || [])
                    setApiExpenses(data?.target_expenses || [])
                    setApiPayments(data?.target_payments || [])
                    setApiShiftClosings(targetClosings)
                    setPrevShiftClosings(dedupeShiftClosingsByDay(data?.prev_shift_closings || []))
                    setYesterdayOrders(data?.prev_orders || [])
                    setYesterdayExpensesData(data?.prev_expenses || [])

                    if (targetClosings.length) {
                        setShiftClosing(targetClosings[targetClosings.length - 1])
                    } else {
                        setShiftClosing(null)
                    }
                })
                .catch((error) => onError?.(error, 'Tải báo cáo theo khoảng'))
                .finally(() => setIsAsyncReady(true))
        }
        // todayISO so a midnight rollover invalidates cached shift_closing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressId, scope, offset, rangeStart, rangeEnd, isTodayScope, todayISO])

    return {
        todayISO,
        isTodayScope,
        rangeStart, rangeEnd, prevStart, prevEnd,
        shiftClosing, setShiftClosing,
        yesterdayClosing,
        yesterdayOrders,
        yesterdayExpensesData,
        apiOrders,
        apiExpenses,
        apiPayments,
        todayPayments, setTodayPayments,
        apiShiftClosings,
        prevShiftClosings,
        isAsyncReady,
    }
}
