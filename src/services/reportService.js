import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN, endOfDayVN, dateStringVN } from '../utils/dateVN'
import { reportCache, historicalCache, invalidateReportCache } from './cache'

// ---- Shift Closing CRUD ----

// Self-heal khi cột cash_closed_at chưa được migrate: lưu phần còn lại thay vì làm vỡ
// "Lưu thực thu". PostgREST trả PGRST204 ("could not find column ... in schema cache")
// cho WRITE cột lạ; Postgres trả 42703 ("undefined_column"). Bắt cả hai + dò message.
function isMissingCashClosedAt(error) {
    if (!error) return false
    if (error.code === 'PGRST204' || error.code === '42703') return true
    return /cash_closed_at/i.test(error.message || '')
}
function omitCashClosedAt(data) {
    const rest = { ...data }
    delete rest.cash_closed_at
    return rest
}

// Unique index uniq_shift_closings_address_vn_day (1 phiếu / address / ngày VN) chặn
// insert trùng ở DB. PostgREST trả 23505 cho vi phạm unique.
function isUniqueViolation(error) {
    if (!error) return false
    return error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || '')
}

// Khi insert đụng unique → self-heal bằng UPDATE phiếu đã có. PHẢI bỏ các field chỉ là
// "mặc định lúc insert" (inventory_report=[], note='') khỏi payload update, nếu không chúng
// sẽ ĐÈ SẠCH dữ liệu phiếu đã tồn tại. Bug thực tế: máy A treo (shiftClosing.id=null vì
// không refetch/realtime), nhân viên máy B kiểm kê xong, A bấm "Lưu thực thu" → insert đụng
// unique → update mang inventory_report=[] → xoá toàn bộ kiểm kê của B. Cash field thì vẫn
// update bình thường (last-write-wins là chấp nhận được với số đếm tiền).
export function stripInsertOnlyDefaults(data) {
    const safe = { ...data }
    if (Array.isArray(safe.inventory_report) && safe.inventory_report.length === 0) delete safe.inventory_report
    if (safe.note === '') delete safe.note
    return safe
}

// Tìm id phiếu chốt cùng NGÀY VN với `refIso` (mặc định now) cho 1 address. Dùng để
// tự lành khi insert đụng unique index → UPDATE phiếu đã có thay vì vỡ "Lưu".
async function findSameDayClosingId(addressId, refIso) {
    if (!addressId || !supabase) return null
    const ref = refIso ? new Date(refIso) : new Date()
    const { data } = await supabase
        .from('shift_closings')
        .select('id')
        .eq('address_id', addressId)
        .gte('closed_at', startOfDayVN(ref).toISOString())
        .lte('closed_at', endOfDayVN(ref).toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data?.id || null
}

// Insert a shift closing record
export async function insertShiftClosing(data) {
    invalidateReportCache(data?.address_id)
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    let { data: row, error } = await supabase
        .from('shift_closings')
        .insert(data)
        .select()
        .single()
    if (isMissingCashClosedAt(error) && 'cash_closed_at' in data) {
        ;({ data: row, error } = await supabase.from('shift_closings').insert(omitCashClosedAt(data)).select().single())
    }
    // Race/insert trùng cùng ngày → unique index chặn. Tự lành: cập nhật phiếu cùng ngày
    // (đúng phiếu report Ngày dùng) thay vì ném lỗi làm hỏng luồng lưu báo cáo/thực thu.
    if (isUniqueViolation(error)) {
        const existingId = await findSameDayClosingId(data.address_id, data.closed_at)
        if (existingId) return updateShiftClosing(existingId, stripInsertOnlyDefaults(data))
    }
    if (error) throw error
    return row
}

// Update an existing shift closing record
export async function updateShiftClosing(id, data) {
    invalidateReportCache(data?.address_id || null)
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    let { data: row, error } = await supabase
        .from('shift_closings')
        .update(data)
        .eq('id', id)
        .select()
        .single()
    if (isMissingCashClosedAt(error) && 'cash_closed_at' in data) {
        ;({ data: row, error } = await supabase.from('shift_closings').update(omitCashClosedAt(data)).eq('id', id).select().single())
    }
    if (error) throw error
    return row
}

// Đường autosave NHẸ cho kiểm kê đa thiết bị: merge các field đã đổi vào inventory_report
// của phiếu hôm nay (tạo phiếu nếu chưa có) qua RPC merge_shift_closing_inventory — race-free
// dưới row lock. KHÔNG refetch ở đây (gọi xong tự nhẹ); convergence do postgres_changes lo.
// `patches`: [{ingredient, unit, opening, opening_locked, remaining, restock}], số = null ⇒ xoá NVL.
export async function mergeShiftClosingInventory(addressId, patches, closedBy, systemTotalRevenue = 0) {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) {
        // Guest local-only: không có đua, merge tay rồi upsert cả mảng.
        const existing = localRepo.fetchLocalShiftClosing(addressId, new Date().toISOString())
        const report = Array.isArray(existing?.inventory_report) ? [...existing.inventory_report] : []
        for (const p of patches) {
            const i = report.findIndex(e => e.ingredient === p.ingredient)
            const tombstone = p.opening == null && p.remaining == null && p.restock == null
            if (i >= 0) report.splice(i, 1)
            if (!tombstone) report.push(p)
        }
        const payload = { address_id: addressId, closed_by: closedBy, inventory_report: report }
        if (!existing?.id) payload.system_total_revenue = systemTotalRevenue
        return localRepo.upsertLocalShiftClosing(payload)
    }
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase.rpc('merge_shift_closing_inventory', {
        p_address_id: addressId,
        p_patches: patches,
        p_closed_by: closedBy || null,
        p_system_total_revenue: systemTotalRevenue || 0,
    })
    if (error) throw error
    // RETURNS shift_closings (composite) → PostgREST may give the object or a 1-element array.
    return Array.isArray(data) ? data[0] : data
}

// get_*_report RPCs liệt kê cột shift_closing tường minh nên KHÔNG trả cash_closed_at.
// Đọc bổ sung bằng 1 PK lookup nhẹ rồi gắn vào shift_closing. Phòng thủ: nếu cột chưa
// migrate (42703) thì coi như null (chưa chốt → mọi khoản là trước chốt).
async function attachCashClosedAt(data) {
    const id = data?.shift_closing?.id
    if (!id || !supabase) return data
    const { data: row, error } = await supabase
        .from('shift_closings')
        .select('cash_closed_at')
        .eq('id', id)
        .single()
    if (!error && row) data.shift_closing.cash_closed_at = row.cash_closed_at || null
    return data
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

// Đã "chốt ca tiền thực thu" hôm nay chưa? Dùng để default phân loại tiền mặt khi nhập
// kho (chưa chốt → 'in_shift', đã chốt → 'post_close'). Phòng thủ: cột chưa migrate
// hoặc lỗi → coi như CHƯA chốt (false) → mặc định 'in_shift'.
export async function fetchCashClosedToday(addressId) {
    if (!addressId) return false
    if (localRepo.isGuest()) {
        const sc = localRepo.fetchLocalShiftClosing(addressId, new Date().toISOString())
        return !!sc?.cash_closed_at
    }
    if (!supabase) return false
    const startOfDay = startOfDayVN()
    const { data, error } = await supabase
        .from('shift_closings')
        .select('cash_closed_at')
        .eq('address_id', addressId)
        .gte('closed_at', startOfDay.toISOString())
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error || !data) return false
    return !!data.cash_closed_at
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

// Helper: attach invoice info to a payment row (mirror RPC's LEFT JOIN).
function attachInvoiceMeta(payments, expenseMap) {
    return (payments || []).map(p => {
        const inv = expenseMap.get(p.expense_id)
        return inv ? { ...p, invoice_name: inv.name, invoice_metadata: inv.metadata } : p
    })
}

// Helper: filter local payments by paid_at range and address.
function filterLocalPayments(addressId, start, end) {
    const sMs = start.getTime(), eMs = end.getTime()
    return localRepo.fetchAllLocalExpensePayments(addressId).filter(p => {
        const t = new Date(p.paid_at).getTime()
        return t >= sMs && t < eMs
    })
}

export async function fetchDailyReportContext(addressId) {
    if (!addressId) return {}
    return reportCache.through([addressId, 'dailyReportContext'], async () => {
        if (localRepo.isGuest()) {
            const todayStr = dateStringVN()
            const yesterday = new Date(startOfDayVN().getTime() - 86_400_000)
            const yesterdayStr = dateStringVN(yesterday)
            const startToday = startOfDayVN()
            const startYday = new Date(yesterday.getTime())
            const allExp = localRepo.fetchAllLocalExpenses(addressId)
            const expMap = new Map(allExp.map(e => [e.id, e]))
            return {
                shift_closing: localRepo.fetchLocalShiftClosing(addressId, todayStr) || null,
                yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || localRepo.fetchLocalYesterdayShiftClosing(addressId) || null,
                yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
                yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr),
                target_payments: attachInvoiceMeta(filterLocalPayments(addressId, startToday, new Date(startToday.getTime() + 86_400_000)), expMap),
                yesterday_payments: attachInvoiceMeta(filterLocalPayments(addressId, startYday, startToday), expMap),
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_daily_report_context', { p_address_id: addressId })
        if (error) throw error
        return await attachCashClosedAt(data || {})
    })
}

export async function fetchReportByDate(addressId, dateStr) {
    return reportCache.through([addressId, 'reportByDate', dateStr], async () => {
        if (localRepo.isGuest()) {
            const targetDateStr = dateStringVN(new Date(dateStr))
            const targetDate = startOfDayVN(new Date(dateStr))
            const targetEnd = new Date(targetDate.getTime() + 86_400_000)

            const yesterday = new Date(targetDate.getTime() - 86_400_000)
            const yesterdayStr = dateStringVN(yesterday)

            const allExp = localRepo.fetchAllLocalExpenses(addressId)
            const expMap = new Map(allExp.map(e => [e.id, e]))

            return {
                shift_closing: localRepo.fetchLocalShiftClosing(addressId, targetDateStr) || null,
                yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || null,
                yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
                yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr),
                target_orders: localRepo.fetchLocalOrders(addressId, targetDateStr),
                target_expenses: localRepo.fetchLocalExpenses(addressId, targetDateStr),
                target_payments: attachInvoiceMeta(filterLocalPayments(addressId, targetDate, targetEnd), expMap),
                yesterday_payments: attachInvoiceMeta(filterLocalPayments(addressId, yesterday, targetDate), expMap),
            }
        }
        if (!supabase) return {}
        const { data, error } = await supabase.rpc('get_report_by_date', { p_address_id: addressId, p_date: dateStr })
        if (error) throw error
        return await attachCashClosedAt(data || {})
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

            const expMap = new Map(allExpenses.map(e => [e.id, e]))
            return {
                target_orders: filterRange(allOrders, tS, tE),
                target_expenses: filterRange(allExpenses, tS, tE),
                target_payments: attachInvoiceMeta(filterLocalPayments(addressId, new Date(tS), new Date(tE)), expMap),
                target_shift_closings: filterRange(allClosings, tS, tE),
                prev_orders: filterRange(allOrders, pS, pE),
                prev_expenses: filterRange(allExpenses, pS, pE),
                prev_payments: attachInvoiceMeta(filterLocalPayments(addressId, new Date(pS), new Date(pE)), expMap),
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
