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
        .select('id, name, amount, staff_name, is_fixed, is_refill, payment_method, metadata, created_at')
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
export async function insertExpense(name, amount, addressId = null, isFixed = false, staffName = null, isRefill = false, paymentMethod = 'cash', metadata = {}) {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) return localRepo.insertLocalExpense({ name, amount, address_id: addressId, is_fixed: isFixed, staff_name: staffName, is_refill: isRefill, payment_method: paymentMethod, metadata })
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { name, amount, is_fixed: isFixed, is_refill: isRefill, payment_method: paymentMethod, metadata }
    if (addressId) payload.address_id = addressId
    if (staffName) payload.staff_name = staffName

    const { data, error } = await supabase
        .from('expenses')
        .insert(payload)
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
        .select('id, name, amount, staff_name, is_fixed, is_refill, payment_method, created_at, address_id')
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
            .select('id, name, amount, staff_name, is_fixed, is_refill, payment_method, metadata, created_at, address_id')
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

// ---- Fixed Costs CRUD ----

// Fetch all active fixed costs for an address
export async function fetchFixedCosts(addressId) {
    return reportCache.through([addressId, 'fixedCosts'], async () => {
        if (localRepo.isGuest()) return localRepo.fetchLocalFixedCosts(addressId)
        if (!supabase) return []
        const { data, error } = await supabase
            .from('fixed_costs')
            .select('id, name, amount, is_active, address_id, created_at')
            .eq('address_id', addressId)
            .eq('is_active', true)
            .order('created_at', { ascending: true })
        if (error) {
            if (error.code !== '42P01') console.error('fetchFixedCosts error:', error)
            return []
        }
        return data || []
    })
}

// Insert a new fixed cost
export async function insertFixedCost(name, amount, addressId) {
    invalidateReportCache(addressId)
    if (localRepo.isGuest()) return localRepo.insertLocalFixedCost({ name, amount, address_id: addressId })
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase
        .from('fixed_costs')
        .insert({ name, amount, address_id: addressId })
        .select()
        .single()
    if (error) throw error
    return data
}

// Update a fixed cost (name and/or amount). addressId unknown — flush all.
export async function updateFixedCost(id, updates) {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return localRepo.updateLocalFixedCost(id, updates)
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { updated_at: new Date().toISOString() }
    if (updates.name !== undefined) payload.name = updates.name
    if (updates.amount !== undefined) payload.amount = updates.amount
    const { data, error } = await supabase
        .from('fixed_costs')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
    if (error) throw error
    return data
}

// Soft-delete a fixed cost. addressId unknown — flush all.
export async function deleteFixedCost(id) {
    invalidateReportCache(null)
    if (localRepo.isGuest()) return localRepo.deleteLocalFixedCost(id)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('fixed_costs')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
    if (error) throw error
    return true
}
