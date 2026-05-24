import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN } from '../utils/dateVN'
import { reportCache, invalidateReportCache } from './cache'

// ---- Expenses CRUD ----

// Fetch today's expenses, newest first (optionally scoped by address)
export async function fetchTodayExpenses(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalExpenses(addressId)
    if (!supabase) return []
    const today = startOfDayVN()

    let query = supabase
        .from('expenses')
        .select('id, name, amount, staff_name, is_fixed, is_refill, payment_method, metadata, category_id, created_at')
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
        // Fallback if table doesn't exist yet (42P01)
        if (error.code !== '42P01') {
            console.error('fetchTodayExpenses error:', error)
        }
        return []
    }
    return data
}

// Insert an expense
// - isFixed: auto-injected fixed costs (rent, salary, etc.) — excluded from cash flow
// - isRefill: "Mua nguyên vật liệu" — excluded from netProfit (COGS already covers it),
//   but counted in cash flow / đối soát
// - paymentMethod: 'cash' | 'transfer' — determines which pot the refill came from
// - metadata: JSONB object for structured data like `{ items: [{ingredient, qty, price}] }`
// - categoryId: FK into expense_categories. NULL is allowed for NVL refills (NVL is
//   in COGS, not a tagged expense). For all other expenses callers should pass the
//   category picked in the form, or omit to let UI default to "Chi phí khác".
export async function insertExpense(name, amount, addressId = null, isFixed = false, staffName = null, isRefill = false, paymentMethod = 'cash', metadata = {}, categoryId = null) {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) return localRepo.insertLocalExpense({ name, amount, address_id: addressId, is_fixed: isFixed, staff_name: staffName, is_refill: isRefill, payment_method: paymentMethod, metadata, category_id: categoryId })
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { name, amount, is_fixed: isFixed, is_refill: isRefill, payment_method: paymentMethod, metadata }
    if (addressId) payload.address_id = addressId
    if (staffName) payload.staff_name = staffName
    if (categoryId) payload.category_id = categoryId

    const { data, error } = await supabase
        .from('expenses')
        .insert(payload)
        .select()
        .single()
    if (error) throw error
    return data
}

// Update an expense (currently only category_id; extend as needed).
// addressId unknown here so flush the whole report cache.
export async function updateExpense(id, updates) {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return localRepo.updateLocalExpense(id, updates)
    if (!supabase) throw new Error('No Supabase connection')
    const payload = {}
    if (updates.category_id !== undefined) payload.category_id = updates.category_id
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.amount !== undefined) payload.amount = updates.amount
    if (updates.payment_method !== undefined) payload.payment_method = updates.payment_method
    const { data, error } = await supabase
        .from('expenses')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
    if (error) throw error
    return data
}

// Delete an expense — addressId unknown here so flush the whole report cache.
export async function deleteExpense(expenseId) {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return localRepo.deleteLocalExpense(expenseId)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expenseId)
    if (error) throw error
    return true
}

// Fetch yesterday's expenses, scoped by address
export async function fetchYesterdayExpenses(addressId) {
    if (localRepo.isGuest()) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return localRepo.fetchLocalExpenses(addressId, yesterday.toISOString())
    }
    if (!supabase) return []
    const today = startOfDayVN()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let query = supabase
        .from('expenses')
        .select('id, name, amount, staff_name, is_fixed, is_refill, payment_method, category_id, created_at, address_id')
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query
    if (error) {
        if (error.code !== '42P01') console.error('fetchYesterdayExpenses error:', error)
        return []
    }
    return data || []
}

// Fetch expenses within a date range
export async function fetchExpensesByRange(addressId, start, end) {
    return reportCache.through([addressId, 'expensesByRange', start.toISOString(), end.toISOString()], async () => {
        if (localRepo.isGuest()) {
            const sMs = start.getTime(), eMs = end.getTime()
            return localRepo.fetchAllLocalExpenses(addressId)
                .filter(x => {
                    const t = new Date(x.created_at).getTime()
                    return t >= sMs && t <= eMs
                })
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        }
        if (!supabase) return []
        let query = supabase
            .from('expenses')
            .select('id, name, amount, staff_name, is_fixed, is_refill, payment_method, metadata, category_id, created_at, address_id')
            .gte('created_at', start.toISOString())
            .lte('created_at', end.toISOString())
        if (addressId) query = query.eq('address_id', addressId)
        const { data, error } = await query.order('created_at', { ascending: false })
        if (error) { console.error('fetchExpensesByRange error:', error); return [] }
        return data || []
    })
}

// Fetch all refill expenses (đi chợ) within a date range, all ingredients
export async function fetchRefillExpensesInRange(addressId, fromDate, toDate) {
    if (localRepo.isGuest()) return localRepo.fetchLocalExpenses(addressId, fromDate) // Simple mapping for now
    if (!supabase || !addressId) return []
    const { data, error } = await supabase
        .from('expenses')
        .select('id, name, amount, staff_name, metadata, created_at')
        .eq('address_id', addressId)
        .eq('is_refill', true)
        .gte('created_at', fromDate)
        .lte('created_at', toDate)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('fetchRefillExpensesInRange error:', error)
        return []
    }
    return data || []
}

// Fetch restock history for a specific ingredient within a date range
export async function fetchIngredientRestockHistory(addressId, ingredient, fromDate, toDate) {
    if (!supabase || !addressId) return []
    const { data, error } = await supabase
        .from('expenses')
        .select('id, name, amount, staff_name, metadata, created_at')
        .eq('address_id', addressId)
        .eq('is_refill', true)
        .gte('created_at', fromDate)
        .lte('created_at', toDate)
        .order('created_at', { ascending: false })

    if (error) {
        console.error('fetchIngredientRestockHistory error:', error)
        return []
    }
    // Filter by ingredient in metadata (client-side, since Supabase JSONB filter syntax varies)
    return (data || []).filter(e => e.metadata?.ingredient === ingredient)
}

// ---- Fixed Costs CRUD removed ----
// Under the "thực chi" model fixed_costs templates are not created or auto-injected.
// Legacy table + column remain in the DB for audit; drop in a future migration.

// ---- Expense Categories CRUD ----
// Tags that group expenses on the profit report. Manager-managed inline through
// the expense form. NVL refills intentionally don't get a category — they're
// in COGS, not the expense breakdown.

export async function fetchExpenseCategories(addressId) {
    if (!addressId) return []
    return reportCache.through([addressId, 'expenseCategories'], async () => {
        if (localRepo.isGuest()) return localRepo.fetchLocalExpenseCategories(addressId)
        if (!supabase) return []
        const { data, error } = await supabase
            .from('expense_categories')
            .select('id, name, group_section, sort_order, is_active, is_default, created_at')
            .eq('address_id', addressId)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
        if (error) {
            if (error.code !== '42P01') console.error('fetchExpenseCategories error:', error)
            return []
        }
        return data || []
    })
}

export async function insertExpenseCategory(addressId, { name, group_section, sort_order = 100 }) {
    if (!addressId) throw new Error('addressId required')
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) return localRepo.insertLocalExpenseCategory({ address_id: addressId, name, group_section, sort_order })
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('expense_categories')
        .insert({ address_id: addressId, name, group_section, sort_order })
        .select()
        .single()
    if (error) throw error
    return data
}

// Partial update. addressId unknown — flush all.
export async function updateExpenseCategory(id, updates) {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return localRepo.updateLocalExpenseCategory(id, updates)
    if (!supabase) throw new Error('No Supabase connection')
    const payload = {}
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.group_section !== undefined) payload.group_section = updates.group_section
    if (updates.sort_order !== undefined) payload.sort_order = updates.sort_order
    const { data, error } = await supabase
        .from('expense_categories')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
    if (error) throw error
    return data
}

// Soft-delete a category. Existing expenses keep the FK but readers should
// treat soft-deleted categories as falling back to "Chi phí khác". We do NOT
// hard-delete because that would null-out historical expense.category_id via
// the ON DELETE SET NULL trigger and lose audit trail.
export async function deleteExpenseCategory(id) {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return localRepo.deleteLocalExpenseCategory(id)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('expense_categories')
        .update({ is_active: false })
        .eq('id', id)
    if (error) throw error
    return true
}
