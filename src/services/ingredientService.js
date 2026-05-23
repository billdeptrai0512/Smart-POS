import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import { startOfDayVN } from '../utils/dateVN'
import { insertExpense } from './expenseService'
import { invalidateReportCache } from './cache'

// ---- Recipes ----

// Fetch all recipes from Supabase (Pure isolated by address)
export async function fetchAllRecipes(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalRecipes(addressId)
    if (!supabase) return []
    let query = supabase.from('recipes').select('product_id, ingredient, amount, unit, address_id')

    if (addressId) {
        query = query.eq('address_id', addressId)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAllRecipes error:', error)
        return []
    }

    return data || []
}

// Fetch recipes for a list of product IDs
export async function fetchRecipes(productIds) {
    if (!supabase) return []
    const { data, error } = await supabase
        .from('recipes')
        .select('product_id, ingredient, amount, unit')
        .in('product_id', productIds)
    if (error) {
        console.error('fetchRecipes error:', error)
        return []
    }
    return data || []
}

// Upsert a recipe row (insert or update ingredient amount for a product)
export async function upsertRecipe(productId, ingredient, amount, addressId = null, unit = null) {
    if (localRepo.isGuest()) return localRepo.upsertLocalRecipe({ product_id: productId, ingredient, amount, address_id: addressId, unit })
    if (!supabase) throw new Error('No Supabase connection')

    const payload = { product_id: productId, ingredient, amount }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    const { error } = await supabase
        .from('recipes')
        .upsert(payload, { onConflict: 'product_id,ingredient,address_id' })
    if (error) throw error
}

// Delete a recipe row
export async function deleteRecipeRow(productId, ingredient, addressId = null) {
    if (localRepo.isGuest()) return localRepo.deleteLocalRecipeRow(productId, ingredient)
    if (!supabase) throw new Error('No Supabase connection')

    let query = supabase
        .from('recipes')
        .delete()
        .eq('product_id', productId)
        .eq('ingredient', ingredient)

    if (addressId) query = query.eq('address_id', addressId)
    else query = query.is('address_id', null)

    const { error } = await query
    if (error) throw error
}

// ---- Ingredient Costs ----

// Fetch ingredient costs + units in one query, return both shapes
export async function fetchIngredientCostsAndUnits(addressId) {
    if (localRepo.isGuest()) {
        const rows = localRepo.fetchLocalIngredientCosts(addressId)
        const costs = {}, units = {}
        rows.forEach(r => {
            costs[r.ingredient] = r.unit_cost
            units[r.ingredient] = r.unit
        })
        return { costs, units, rows }
    }
    if (!supabase) return { costs: {}, units: {}, rows: [] }
    // ingredient_costs is now per-address (like products/recipes). Default rows
    // (address_id IS NULL) are a one-time seed/template — copied to each new
    // address via the seed_address_ingredient_costs trigger and the backfill in
    // migration 20260518_decouple_ingredient_costs.sql. Admin edits to default
    // rows DO NOT propagate to existing active addresses.
    let query = supabase.from('ingredient_costs').select('ingredient, unit_cost, unit, address_id, pack_size, pack_unit, min_stock, category')

    if (addressId) {
        query = query.eq('address_id', addressId)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchIngredientCostsAndUnits error:', error)
        return { costs: {}, units: {}, rows: [] }
    }
    if (!data || data.length === 0) return { costs: {}, units: {}, rows: [] }

    const costs = {}
    const units = {}
    const rows = []
    for (const d of data) {
        costs[d.ingredient] = d.unit_cost
        units[d.ingredient] = d.unit || 'đv'
        rows.push({ ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost, pack_size: d.pack_size, pack_unit: d.pack_unit, min_stock: d.min_stock, category: d.category || null })
    }
    return { costs, units, rows }
}

// Kept for backward-compat with callers that only need the costs map
export async function fetchIngredientCosts(addressId) {
    const { costs } = await fetchIngredientCostsAndUnits(addressId)
    return costs
}

// Kept for backward-compat — delegates to fetchIngredientCostsAndUnits
export async function fetchIngredientCostsWithUnits(addressId) {
    const { rows } = await fetchIngredientCostsAndUnits(addressId)
    return rows
}

// Upsert an ingredient cost
export async function upsertIngredientCost(ingredient, unitCost, addressId = null, unit = null, opts = {}) {
    if (localRepo.isGuest()) return localRepo.upsertLocalIngredientCost({ ingredient, unit_cost: unitCost, address_id: addressId, unit, ...opts })
    if (!supabase) throw new Error('No Supabase connection')

    const payload = { ingredient, unit_cost: unitCost }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    if (opts.packSize !== undefined) payload.pack_size = opts.packSize || null
    if (opts.packUnit !== undefined) payload.pack_unit = opts.packUnit || null
    if (opts.minStock !== undefined) payload.min_stock = opts.minStock || null
    if (opts.category !== undefined) payload.category = opts.category || null

    const { error } = await supabase
        .from('ingredient_costs')
        .upsert(payload, { onConflict: 'ingredient,address_id' })
    if (error) throw error
}

// Sync (rename or merge) an ingredient key across ingredient_costs, recipes,
// shift_closings.inventory_report (JSONB), and expenses.metadata (JSONB).
// Always-merge mode: if newKey already exists in ingredient_costs for this address,
// the oldKey row is deleted (newKey kept as canonical). See migration 20260519.
//
// Returns: { recipes_updated, closings_updated, expenses_updated, costs_action }
//   costs_action ∈ 'renamed' | 'merged' | 'none' | 'noop'
export async function syncIngredientKey(addressId, oldKey, newKey) {
    if (localRepo.isGuest()) {
        await localRepo.renameLocalIngredient(oldKey, newKey)
        return { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'renamed' }
    }
    if (!supabase) throw new Error('No Supabase connection')
    if (!addressId) throw new Error('addressId required for syncIngredientKey')
    if (oldKey === newKey) return { recipes_updated: 0, closings_updated: 0, expenses_updated: 0, costs_action: 'noop' }
    const { data, error } = await supabase.rpc('sync_ingredient_key', {
        p_address_id: addressId,
        p_old_key: oldKey,
        p_new_key: newKey
    })
    if (error) throw error
    return data
}

// Backwards-compat shim — old callers used `renameIngredient(oldKey, newKey)` without addressId.
// The old `rename_ingredient` RPC was never deployed, so this path was broken.
// Now delegates to syncIngredientKey. AddressId must be passed explicitly going forward.
export async function renameIngredient(oldKey, newKey, addressId) {
    return await syncIngredientKey(addressId, oldKey, newKey)
}

// Delete an ingredient cost entry — also cleans recipes + extra_ingredients for this address.
// Uses the delete_ingredient RPC for atomic cleanup across all tables.
export async function deleteIngredientCost(ingredient, addressId = null) {
    if (localRepo.isGuest()) return localRepo.deleteLocalIngredientCost(ingredient)
    if (!supabase) throw new Error('No Supabase connection')

    if (addressId) {
        // Use RPC for full cleanup (ingredient_costs + recipes + extra_ingredients)
        const { error } = await supabase.rpc('delete_ingredient', {
            p_address_id: addressId,
            p_ingredient: ingredient
        })
        if (error) throw error
    } else {
        // Fallback: global default row only (no address scoping available)
        await supabase.from('ingredient_costs').delete()
            .eq('ingredient', ingredient)
            .is('address_id', null)
    }
    return true
}

// ---- Ingredient Stock (warehouse + counter) ----

// current_stock = warehouse_stock + counter_stock, trong đó:
//   warehouse_stock = Σ refill (đi chợ qua /ingredient) − Σ restock chỉ tính từ shift_closings xảy ra
//                     SAU lần refill đầu tiên của nguyên liệu đó (restock trước đó là tồn pre-system, bỏ qua).
//   counter_stock   = remaining từ shift_closing gần nhất.
// Nếu chưa có refill nào → warehouse=0; chưa có shift_closing → counter=0.
//
// Path nhanh: RPC `get_ingredient_stocks_v2` aggregate server-side (1 round-trip).
// Fallback: smart 2-step JS aggregate khi RPC chưa deploy (PGRST202 / 42883).
let _warnedFetchStocksFallback = false
export async function fetchIngredientStocks(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalIngredientStocks(addressId)
    if (!supabase) return []

    // Default address (addressId=null) = global playground template. Anon callers can't
    // read expenses/shift_closings directly (RLS), so use a SECURITY DEFINER RPC that
    // returns aggregated stock for address_id IS NULL.
    const isDefault = !addressId
    const mapRow = (row) => ({
        ingredient: row.ingredient,
        current_stock: Number(row.current_stock) || 0,
        restocked_qty: Number(row.restocked_qty) || 0,
        warehouse_stock: Number(row.warehouse_stock) || 0,
        counter_stock: Number(row.counter_stock) || 0
    })

    if (isDefault) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_default_ingredient_stocks')
        if (!rpcError && rpcData) return rpcData.map(mapRow)
        if (rpcError && rpcError.code !== 'PGRST202' && rpcError.code !== '42883') {
            console.error('get_default_ingredient_stocks RPC error:', rpcError)
        }
        // Fallback (admin contexts only — anon callers will hit RLS here and get []).
        // Kept so deploying the migration is non-blocking.
    } else {
        // Fast path — only when we have a real UUID
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_ingredient_stocks_v2', { p_address_id: addressId })
        if (!rpcError && rpcData) return rpcData.map(mapRow)
        if (rpcError && rpcError.code !== 'PGRST202' && rpcError.code !== '42883') {
            console.error('get_ingredient_stocks_v2 RPC error:', rpcError)
        } else if (!_warnedFetchStocksFallback) {
            _warnedFetchStocksFallback = true
            console.warn('[fetchIngredientStocks] RPC missing — using slow fallback. Deploy migration 20260516_rpc_ingredient_stocks_v2.sql for ~20× speedup.')
        }
    }

    const applyAddrFilter = (q) => isDefault ? q.is('address_id', null) : q.eq('address_id', addressId)

    // Fallback step 1: recent closings + all refills (parallel, both small).
    // Walk N=30 latest closings (DESC) so we can carry forward the most-recent
    // non-null `remaining` per ingredient — null means staff didn't count that
    // ingredient that shift, so we keep yesterday's counter instead of zeroing.
    const [latestRes, refillsRes] = await Promise.all([
        applyAddrFilter(
            supabase
                .from('shift_closings')
                .select('created_at, inventory_report')
        )
            .order('created_at', { ascending: false })
            .limit(30),
        applyAddrFilter(
            supabase
                .from('expenses')
                .select('created_at, metadata')
        ).eq('is_refill', true)
    ])

    const counter = {}
    const todayRestock = {}
    const closingsDesc = Array.isArray(latestRes.data) ? latestRes.data : []

    // todayRestock = restock from THE latest closing only (today's restock).
    const latestReport = Array.isArray(closingsDesc[0]?.inventory_report) ? closingsDesc[0].inventory_report : []
    latestReport.forEach(item => {
        if (item.ingredient && item.restock != null) {
            todayRestock[item.ingredient] = Number(item.restock)
        }
    })

    // counter = most-recent non-null remaining per ingredient. Walking DESC and
    // only writing on first hit means yesterday's count wins when today is null.
    closingsDesc.forEach(closing => {
        const report = Array.isArray(closing.inventory_report) ? closing.inventory_report : []
        report.forEach(item => {
            if (!item.ingredient) return
            if (item.remaining != null && counter[item.ingredient] === undefined) {
                counter[item.ingredient] = Number(item.remaining)
            }
        })
    })

    // First refill timestamp + total refill per ingredient
    const totalRefill = {}
    const firstRefillAt = {}
    ;(refillsRes.data || []).forEach(e => {
        const ing = e.metadata?.ingredient
        if (!ing) return
        totalRefill[ing] = (totalRefill[ing] || 0) + (Number(e.metadata?.qty) || 0)
        const t = new Date(e.created_at).getTime()
        if (firstRefillAt[ing] === undefined || t < firstRefillAt[ing]) {
            firstRefillAt[ing] = t
        }
    })

    // Fallback step 2: shift_closings bounded by earliest first_refill_at.
    // Older closings can't contribute restock (JS aggregator filters them out anyway),
    // so we skip fetching them entirely. Skip the query if no refills exist yet.
    const totalRestock = {}
    const refillTimes = Object.values(firstRefillAt)
    if (refillTimes.length > 0) {
        const earliestRefillISO = new Date(Math.min(...refillTimes)).toISOString()
        const { data: closingsData } = await applyAddrFilter(
            supabase
                .from('shift_closings')
                .select('created_at, inventory_report')
        ).gte('created_at', earliestRefillISO)

        ;(closingsData || []).forEach(closing => {
            const report = Array.isArray(closing.inventory_report) ? closing.inventory_report : []
            const closingTime = new Date(closing.created_at).getTime()
            report.forEach(item => {
                const ing = item.ingredient
                if (!ing) return
                const refillStart = firstRefillAt[ing]
                if (refillStart === undefined || closingTime < refillStart) return
                totalRestock[ing] = (totalRestock[ing] || 0) + (Number(item.restock) || 0)
            })
        })
    }

    const keys = new Set([
        ...Object.keys(counter),
        ...Object.keys(totalRestock),
        ...Object.keys(totalRefill)
    ])
    return Array.from(keys).map(ingredient => {
        const warehouseRaw = (totalRefill[ingredient] || 0) - (totalRestock[ingredient] || 0)
        const warehouse = Math.max(0, warehouseRaw)
        const counterStock = counter[ingredient] || 0
        return {
            ingredient,
            current_stock: warehouse + counterStock,
            restocked_qty: todayRestock[ingredient] || 0,
            warehouse_stock: warehouse,
            counter_stock: counterStock
        }
    })
}

// Per-ingredient daily metrics for /ingredients expand-on-click context (Task 3.8).
// Returns map ingredient → { today_refill, today_restock }. Combine with current
// warehouse_stock (from fetchIngredientStocks) to derive:
//   warehouse_end_of_today   = current warehouse_stock
//   warehouse_start_of_today = warehouse_end + today_restock − today_refill
export async function fetchIngredientDailyContext(addressId) {
    const startISO = startOfDayVN().toISOString()
    if (localRepo.isGuest()) {
        const startMs = new Date(startISO).getTime()
        const result = {}
        const expenses = localRepo.fetchAllLocalExpenses(addressId)
        for (const e of expenses) {
            if (!e.is_refill || !e.metadata?.ingredient) continue
            if (new Date(e.created_at).getTime() < startMs) continue
            const ing = e.metadata.ingredient
            result[ing] = result[ing] || { today_refill: 0, today_restock: 0 }
            result[ing].today_refill += Number(e.metadata.qty || 0)
        }
        const closings = localRepo.fetchAllLocalShiftClosings(addressId)
        for (const sc of closings) {
            if (new Date(sc.created_at).getTime() < startMs) continue
            for (const item of (sc.inventory_report || [])) {
                if (!item.ingredient) continue
                result[item.ingredient] = result[item.ingredient] || { today_refill: 0, today_restock: 0 }
                result[item.ingredient].today_restock += Number(item.restock || 0)
            }
        }
        return result
    }
    if (!supabase) return {}
    const isDefault = !addressId
    const apply = (q) => isDefault ? q.is('address_id', null) : q.eq('address_id', addressId)
    const [refillsRes, closingsRes] = await Promise.all([
        apply(supabase.from('expenses').select('metadata')).eq('is_refill', true).gte('created_at', startISO),
        apply(supabase.from('shift_closings').select('inventory_report')).gte('created_at', startISO)
    ])
    const result = {}
    for (const e of refillsRes.data || []) {
        const ing = e.metadata?.ingredient
        if (!ing) continue
        result[ing] = result[ing] || { today_refill: 0, today_restock: 0 }
        result[ing].today_refill += Number(e.metadata?.qty || 0)
    }
    for (const sc of closingsRes.data || []) {
        for (const item of (sc.inventory_report || [])) {
            if (!item.ingredient) continue
            result[item.ingredient] = result[item.ingredient] || { today_refill: 0, today_restock: 0 }
            result[item.ingredient].today_restock += Number(item.restock || 0)
        }
    }
    return result
}

// Compute raw warehouse balance per ingredient (Σ refill_qty − Σ restock_post_first_refill).
// Without the `max(0, ...)` clamp that fetchIngredientStocks applies. Negative values mean
// staff over-reported restock OR bought outside the system — `/ingredients` surfaces these
// as a "kho lệch sổ sách" banner so manager can reconcile via the Kiểm kê & reset flow.
export async function fetchIngredientDeficits(addressId) {
    if (localRepo.isGuest()) {
        const expenses = localRepo.fetchAllLocalExpenses(addressId).filter(e => e.is_refill && e.metadata?.ingredient)
        const closings = localRepo.fetchAllLocalShiftClosings(addressId)
        return computeDeficits(expenses, closings)
    }
    if (!supabase) return []
    const isDefault = !addressId
    const applyAddrFilter = (q) => isDefault ? q.is('address_id', null) : q.eq('address_id', addressId)
    const [refillsRes, closingsRes] = await Promise.all([
        applyAddrFilter(supabase.from('expenses').select('created_at, metadata')).eq('is_refill', true),
        applyAddrFilter(supabase.from('shift_closings').select('created_at, inventory_report'))
    ])
    return computeDeficits(refillsRes.data || [], closingsRes.data || [])
}

function computeDeficits(refills, closings) {
    // Group refills: Σ qty + earliest created_at per ingredient
    const totalRefill = {}
    const firstRefillAt = {}
    for (const e of refills) {
        const ing = e.metadata?.ingredient
        if (!ing) continue
        totalRefill[ing] = (totalRefill[ing] || 0) + (Number(e.metadata?.qty) || 0)
        const t = new Date(e.created_at).getTime()
        if (firstRefillAt[ing] === undefined || t < firstRefillAt[ing]) firstRefillAt[ing] = t
    }
    // Σ restock per ingredient, only counting closings on/after that ingredient's first refill
    const totalRestock = {}
    for (const sc of closings) {
        const report = Array.isArray(sc.inventory_report) ? sc.inventory_report : []
        const t = new Date(sc.created_at).getTime()
        for (const item of report) {
            const ing = item.ingredient
            if (!ing) continue
            const start = firstRefillAt[ing]
            if (start === undefined || t < start) continue
            totalRestock[ing] = (totalRestock[ing] || 0) + (Number(item.restock) || 0)
        }
    }
    const deficits = []
    for (const ing of Object.keys(totalRefill)) {
        const raw = totalRefill[ing] - (totalRestock[ing] || 0)
        if (raw < 0) deficits.push({ ingredient: ing, refill: totalRefill[ing], restock: totalRestock[ing] || 0, deficit: raw })
    }
    return deficits
}

// Manual stock adjustment (kiểm kê / hao hụt / seed initial).
// Tạo 1 expense `is_refill=true, amount=0, metadata.adjustment=true, qty=delta` —
// được sum vào Σrefill_qty của fetchIngredientStocks → warehouse +delta.
// Không động unit_cost (giá vốn giữ nguyên). Filter `metadata.adjustment` ra khỏi tab Đi chợ ở client.
export async function adjustIngredientStock(addressId, ingredient, delta, staffName) {
    if (localRepo.isGuest()) {
        const displayName = `Hiệu chỉnh tồn ${ingredient}`
        return await insertExpense(displayName, 0, addressId, false, staffName, true, 'cash', { ingredient, qty: delta, adjustment: true })
    }
    if (!supabase) throw new Error('No Supabase connection')
    if (!Number.isFinite(delta) || delta === 0) return null
    const displayName = `Hiệu chỉnh tồn ${ingredient}`
    return await insertExpense(
        displayName,
        0,
        addressId,
        false,
        staffName,
        true,
        'cash',
        { ingredient, qty: delta, adjustment: true }
    )
}

// Process a restock: updates COGS, creates expense, returns result
export async function processIngredientRestock(addressId, ingredient, qty, totalCost, staffName) {
    let result
    if (localRepo.isGuest()) {
        // 1. Update unit cost
        const unitCost = Number(qty) > 0 ? Math.round(Number(totalCost) / Number(qty)) : 0
        await upsertIngredientCost(ingredient, unitCost, addressId)
        // 2. Insert expense
        const displayName = `Đi chợ: ${ingredient}`
        result = await insertExpense(displayName, totalCost, addressId, false, staffName, true, 'cash', { ingredient, qty, totalCost })
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        if (addressId) {
            const { data, error } = await supabase.rpc('process_ingredient_restock', {
                p_address_id: addressId,
                p_ingredient: ingredient,
                p_qty: qty,
                p_total_cost: totalCost,
                p_staff_name: staffName
            })
            if (error) throw error
            result = data
        } else {
            // Default address (template). RPC requires UUID — do the two writes manually so
            // admins can exercise the full restock flow on the global template.
            const unitCost = Number(qty) > 0 ? Math.round(Number(totalCost) / Number(qty)) : 0
            await upsertIngredientCost(ingredient, unitCost, null)
            const displayName = `Đi chợ: ${ingredient}`
            result = await insertExpense(displayName, totalCost, null, false, staffName, true, 'cash', { ingredient, qty, totalCost })
        }
    }
    invalidateReportCache(addressId)
    return result
}
