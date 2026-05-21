import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN, dateStringVN } from '../utils/dateVN'
import { reportCache, historicalCache, invalidateReportCache } from './cache'

// ---- Shift Closing CRUD ----

// Insert a shift closing record
export async function insertShiftClosing(data) {
    invalidateReportCache(data?.address_id)
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    const { data: row, error } = await supabase
        .from('shift_closings')
        .insert(data)
        .select()
        .single()
    if (error) throw error
    return row
}

// Update an existing shift closing record
export async function updateShiftClosing(id, data) {
    invalidateReportCache(data?.address_id || null)
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    const { data: row, error } = await supabase
        .from('shift_closings')
        .update(data)
        .eq('id', id)
        .select()
        .single()
    if (error) throw error
    return row
}

// Fetch shift closings within a date range (for summing cash/transfer)
export async function fetchShiftClosingsByRange(addressId, start, end) {
    if (localRepo.isGuest()) {
        const sMs = start.getTime(), eMs = end.getTime()
        return localRepo.fetchAllLocalShiftClosings(addressId).filter(s => {
            const t = new Date(s.closed_at || s.created_at).getTime()
            return t >= sMs && t <= eMs
        })
    }
    if (!supabase) return []
    const { data, error } = await supabase
        .from('shift_closings')
        .select('actual_cash, actual_transfer, system_total_revenue, closed_at')
        .eq('address_id', addressId)
        .gte('closed_at', start.toISOString())
        .lte('closed_at', end.toISOString())
    if (error) { console.error('fetchShiftClosingsByRange error:', error); return [] }
    return data || []
}

// Fetch today's shift closing for an address (latest one)
export async function fetchTodayShiftClosing(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalShiftClosing(addressId, new Date().toISOString())
    if (!supabase) return null
    const startOfDay = startOfDayVN()

    const { data, error } = await supabase
        .from('shift_closings')
        .select('id, closed_at, address_id, inventory_report, actual_cash, actual_transfer, system_total_revenue')
        .eq('address_id', addressId)
        .gte('closed_at', startOfDay.toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) {
        console.error('fetchTodayShiftClosing error:', error)
        return null
    }
    return data
}

// Fetch the most recent shift closing BEFORE today (for opening stock)
export async function fetchYesterdayShiftClosing(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalYesterdayShiftClosing(addressId)
    if (!supabase) return null
    const startOfDay = startOfDayVN()

    const { data, error } = await supabase
        .from('shift_closings')
        .select('id, closed_at, address_id, inventory_report')
        .eq('address_id', addressId)
        .lt('closed_at', startOfDay.toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) {
        console.error('fetchYesterdayShiftClosing error:', error)
        return null
    }
    return data
}

// ---- Historical reads (immutable past data) ----

// Fetch order items for the past `days` fully completed days (excluding today)
export async function fetchPastDaysOrderItems(addressId, days = 7) {
    return historicalCache.through([addressId, 'pastDaysItems', days, dateStringVN()], async () => {
        if (!supabase) return []
        const endDate = startOfDayVN()

        const startDate = new Date(endDate)
        startDate.setDate(startDate.getDate() - days)

        let query = supabase
            .from('orders')
            .select(`
                order_items (
                    quantity,
                    product_id,
                    extra_ids
                )
            `)
            .is('deleted_at', null)
            .gte('created_at', startDate.toISOString())
            .lt('created_at', endDate.toISOString())

        if (addressId) query = query.eq('address_id', addressId)

        const { data, error } = await query
        if (error) {
            console.error('fetchPastDaysOrderItems error:', error)
            return []
        }

        // Flatten order items
        const allItems = []
        data.forEach(o => {
            if (o.order_items) {
                o.order_items.forEach(i => allItems.push(i))
            }
        })
        return allItems
    })
}

// Fetch order items for exactly "same day last week" (for tomorrow's prediction, so 6 days ago)
export async function fetchLastWeekSameDayOrderItems(addressId) {
    return historicalCache.through([addressId, 'lastWeekSameDay', dateStringVN()], async () => {
        if (!supabase) return []
        // If today is Tuesday, tomorrow is Wednesday. We want to predict tomorrow using Today and Last Wednesday.
        // Last Wednesday is Today - 6 days.
        const today = startOfDayVN()

        const targetDate = new Date(today)
        targetDate.setDate(targetDate.getDate() - 6)

        const nextDate = new Date(targetDate)
        nextDate.setDate(nextDate.getDate() + 1)

        let query = supabase
            .from('orders')
            .select(`
                order_items (
                    quantity,
                    product_id,
                    extra_ids
                )
            `)
            .is('deleted_at', null)
            .gte('created_at', targetDate.toISOString())
            .lt('created_at', nextDate.toISOString())

        if (addressId) query = query.eq('address_id', addressId)

        const { data, error } = await query
        if (error) {
            console.error('fetchLastWeekSameDayOrderItems error:', error)
            return []
        }

        const allItems = []
        data.forEach(o => {
            if (o.order_items) {
                o.order_items.forEach(i => allItems.push(i))
            }
        })
        return allItems
    })
}

// ---- Reports (Daily / Range) ----
// Backed by the shared reportCache so toggling between Báo cáo / Nhật ký tabs
// feels instant. Cache invalidates on any write to the underlying tables via
// invalidateReportCache(). Existing call sites use invalidateDailyContext() as
// the public API; it forwards to invalidateReportCache.
export function invalidateDailyContext(addressId) {
    invalidateReportCache(addressId)
}

export async function fetchDailyReportContext(addressId) {
    if (!addressId) return {}
    return reportCache.through([addressId, 'dailyReportContext'], async () => {
        if (localRepo.isGuest()) {
            const todayStr = dateStringVN()
            const yesterday = new Date(startOfDayVN().getTime() - 86_400_000)
            const yesterdayStr = dateStringVN(yesterday)
            return {
                shift_closing: localRepo.fetchLocalShiftClosing(addressId, todayStr) || null,
                yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || localRepo.fetchLocalYesterdayShiftClosing(addressId) || null,
                yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
                yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr)
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_daily_report_context', { p_address_id: addressId })
        if (error) throw error
        return data || {}
    })
}

export async function fetchReportByDate(addressId, dateStr) {
    return reportCache.through([addressId, 'reportByDate', dateStr], async () => {
        if (localRepo.isGuest()) {
            const targetDateStr = dateStringVN(new Date(dateStr))
            const targetDate = startOfDayVN(new Date(dateStr))

            const yesterday = new Date(targetDate.getTime() - 86_400_000)
            const yesterdayStr = dateStringVN(yesterday)

            return {
                shift_closing: localRepo.fetchLocalShiftClosing(addressId, targetDateStr) || null,
                yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || null,
                yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
                yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr),
                target_orders: localRepo.fetchLocalOrders(addressId, targetDateStr),
                target_expenses: localRepo.fetchLocalExpenses(addressId, targetDateStr)
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_report_by_date', { p_address_id: addressId, p_date: dateStr })
        if (error) throw error
        return data || {}
    })
}

export async function fetchReportByRange(addressId, targetStart, targetEnd, prevStart, prevEnd) {
    return reportCache.through([addressId, 'reportByRange', targetStart, targetEnd, prevStart, prevEnd], async () => {
        if (localRepo.isGuest()) {
            const allOrders = localRepo.fetchAllLocalOrders(addressId)
            const allExpenses = localRepo.fetchAllLocalExpenses(addressId)
            const allClosings = localRepo.fetchAllLocalShiftClosings(addressId)

            const tS = new Date(targetStart).getTime()
            const tE = new Date(targetEnd).getTime()
            const pS = new Date(prevStart).getTime()
            const pE = new Date(prevEnd).getTime()

            const filterRange = (list, start, end) => list.filter(x => {
                const t = new Date(x.created_at).getTime()
                return t >= start && t <= end && x.address_id === addressId
            })

            return {
                target_orders: filterRange(allOrders, tS, tE),
                target_expenses: filterRange(allExpenses, tS, tE),
                target_shift_closings: filterRange(allClosings, tS, tE),
                prev_orders: filterRange(allOrders, pS, pE),
                prev_expenses: filterRange(allExpenses, pS, pE),
                prev_shift_closings: filterRange(allClosings, pS, pE)
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_report_by_range', {
            p_address_id: addressId,
            p_target_start: targetStart,
            p_target_end: targetEnd,
            p_prev_start: prevStart,
            p_prev_end: prevEnd
        })
        if (error) throw error
        return data || {}
    })
}

// Fetch current inventory (Disabled for now)
export async function fetchInventory() {
    return {}
}
