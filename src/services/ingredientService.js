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
    // Try with category first; fall back to legacy SELECT if migration
    // 20260523_add_ingredient_category.sql isn't deployed yet (Postgres 42703).
    const BASE = 'ingredient, unit_cost, unit, address_id, pack_size, pack_unit, min_stock'
    const runQuery = async (cols) => {
        let q = supabase.from('ingredient_costs').select(cols)
        q = addressId ? q.eq('address_id', addressId) : q.is('address_id', null)
        return await q
    }

    // Try newest schema first, degrade column-by-column on undefined_column (42703)
    // so the page still loads if count_in_audit / category migrations aren't deployed.
    let { data, error } = await runQuery(`${BASE}, category, count_in_audit`)
    if (error?.code === '42703') ({ data, error } = await runQuery(`${BASE}, category`))
    if (error?.code === '42703') ({ data, error } = await runQuery(BASE))
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
        rows.push({ ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost, pack_size: d.pack_size, pack_unit: d.pack_unit, min_stock: d.min_stock, category: d.category || null, count_in_audit: d.count_in_audit ?? true })
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

    // `??` so an explicit 0 / '' passed by the UI is preserved.
    // Caller passes null/undefined when intentionally clearing the field.
    if (opts.packSize !== undefined) payload.pack_size = opts.packSize ?? null
    if (opts.packUnit !== undefined) payload.pack_unit = opts.packUnit ?? null
    if (opts.minStock !== undefined) payload.min_stock = opts.minStock ?? null
    if (opts.category !== undefined) payload.category = opts.category ?? null
    if (opts.countInAudit !== undefined) payload.count_in_audit = !!opts.countInAudit

    const upsert = (body) => supabase
        .from('ingredient_costs')
        .upsert(body, { onConflict: 'ingredient,address_id' })
    // PostgREST trả PGRST204 ("could not find column in schema cache") khi WRITE cột
    // chưa migrate; Postgres trả 42703. Bắt cả hai + dò tên cột để degrade an toàn.
    const missingCol = (error, col) =>
        !!error && (error.code === 'PGRST204' || error.code === '42703' || new RegExp(col).test(error.message || ''))

    let { error } = await upsert(payload)
    // Degrade dần nếu cột optional chưa migrate: bỏ count_in_audit trước, rồi category.
    if (missingCol(error, 'count_in_audit') && 'count_in_audit' in payload) {
        const { count_in_audit: _a, ...rest } = payload
        ;({ error } = await upsert(rest))
        if (missingCol(error, 'category') && 'category' in rest) {
            const { category: _c, ...rest2 } = rest
            ;({ error } = await upsert(rest2))
        }
    } else if (missingCol(error, 'category') && 'category' in payload) {
        const { category: _drop, ...rest } = payload
        ;({ error } = await upsert(rest))
    }
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
        return localRepo.renameLocalIngredient(addressId, oldKey, newKey)
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
        ).eq('is_refill', true).limit(10000)  // disaster cap; RPC path has no such ceiling.
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

// Lượt "rút từ kho ra quầy" của 1 nguyên liệu trong khoảng thời gian — chính là số
// "Nhập thêm" (restock) ghi trong phiếu chốt ca (shift_closings.inventory_report).
// Nhật ký NVL hiển thị mỗi phiếu có restock > 0 thành 1 card riêng (chuyển kho nội
// bộ, không có tiền).
//
// Snapshot "Tồn kho trước → sau" được DỰNG LẠI bằng replay toàn bộ lịch sử của
// nguyên liệu (mọi phiếu nhập/hiệu chỉnh + mọi lượt rút, không chỉ tháng đang xem)
// — cùng quy tắc với fetchIngredientStocks: rút TRƯỚC lần nhập kho đầu tiên không
// trừ kho (snapshot để null). Vì vậy phải fetch full-history thay vì chỉ cửa sổ tháng.
//
// staff_name = người TẠO phiếu chốt ca (closed_by) — phiếu được người khác sửa
// sau đó thì không có dấu vết, đành chịu (DB không ghi ai update).
// Trả về [{ id, created_at, qty, before_stock, after_stock, staff_name }] DESC.
export async function fetchIngredientWithdrawals(addressId, ingredient, fromDate, toDate) {
    const replay = (refills, closings) => {
        const events = []
        for (const e of refills || []) {
            if (e.metadata?.ingredient !== ingredient) continue
            events.push({
                t: new Date(e.created_at).getTime(),
                kind: 'refill',
                qty: Number(e.metadata?.qty) || 0,
            })
        }
        for (const c of closings || []) {
            const report = Array.isArray(c.inventory_report) ? c.inventory_report : []
            const item = report.find(i => i?.ingredient === ingredient)
            const qty = Number(item?.restock) || 0
            if (qty <= 0) continue
            events.push({
                t: new Date(c.created_at).getTime(),
                kind: 'withdrawal',
                qty,
                id: c.id || c.created_at,
                created_at: c.created_at,
                staff_name: c.closer?.name || null,
            })
        }
        // Cùng timestamp (hiếm): cho refill chạy trước để kho không âm giả.
        events.sort((a, b) => a.t - b.t
            || (a.kind === b.kind ? 0 : a.kind === 'refill' ? -1 : 1))

        const fromMs = new Date(fromDate).getTime()
        const toMs = new Date(toDate).getTime()
        const out = []
        let warehouse = 0
        let started = false
        for (const ev of events) {
            if (ev.kind === 'refill') {
                warehouse += ev.qty
                started = true
                continue
            }
            let before = null, after = null
            if (started) {
                before = roundStock(warehouse)
                warehouse -= ev.qty
                after = roundStock(warehouse)
            }
            if (ev.t >= fromMs && ev.t <= toMs) {
                out.push({
                    id: ev.id, created_at: ev.created_at, qty: ev.qty,
                    before_stock: before, after_stock: after,
                    staff_name: ev.staff_name,
                })
            }
        }
        return out.reverse()
    }

    if (localRepo.isGuest()) {
        return replay(
            localRepo.fetchAllLocalExpenses(addressId).filter(e => e.is_refill),
            localRepo.fetchAllLocalShiftClosings(addressId),
        )
    }
    if (!supabase || !addressId) return []
    const closingsQuery = (sel) => supabase
        .from('shift_closings')
        .select(sel)
        .eq('address_id', addressId)
    const [refillsRes, closingsRes] = await Promise.all([
        supabase
            .from('expenses')
            .select('created_at, metadata')
            .eq('address_id', addressId)
            .eq('is_refill', true),
        closingsQuery('id, created_at, inventory_report, closer:users!closed_by(name)'),
    ])
    if (refillsRes.error) {
        console.error('fetchIngredientWithdrawals refills error:', refillsRes.error)
        return []
    }
    let closings = closingsRes.data
    if (closingsRes.error) {
        // Join users thất bại (RLS/FK đổi tên) → fallback không có tên người chốt.
        const retry = await closingsQuery('id, created_at, inventory_report')
        if (retry.error) {
            console.error('fetchIngredientWithdrawals closings error:', retry.error)
            return []
        }
        closings = retry.data
    }
    return replay(refillsRes.data, closings)
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
//
// opts.beforeStock: warehouse stock the user saw when initiating the edit. Stored
// in metadata as `before_stock` + derived `after_stock = before + delta` so the
// Nhật ký card can render "Tồn X → Y" honestly. Best-effort — two concurrent
// edits would race, but for a 1–3 staff coffee cart that's an acceptable
// approximation. Caller passes `null` / omits when the value isn't known.
export async function adjustIngredientStock(addressId, ingredient, delta, staffName, opts = {}) {
    if (!Number.isFinite(delta) || delta === 0) return null
    const displayName = `Hiệu chỉnh tồn ${ingredient}`
    const meta = { ingredient, qty: delta, adjustment: true }
    if (Number.isFinite(opts?.beforeStock)) {
        // 1-decimal round matches the Tồn kho display, so the snapshot reads
        // identically to what the user saw on the row when they opened edit.
        const before = roundStock(Number(opts.beforeStock))
        meta.before_stock = before
        meta.after_stock = roundStock(before + delta)
    }
    if (localRepo.isGuest()) {
        return await insertExpense(displayName, 0, addressId, false, staffName, true, 'cash', meta)
    }
    if (!supabase) throw new Error('No Supabase connection')
    return await insertExpense(displayName, 0, addressId, false, staffName, true, 'cash', meta)
}

// Stock numbers are stored as floats (WAC math can produce arbitrary precision).
// Card UI rounds to 1 decimal; persist the same precision so historical reads
// don't reveal accumulated float noise.
function roundStock(x) {
    return Math.round(x * 10) / 10
}

// Đặt tồn QUẦY (counter) = số đếm tuyệt đối, bằng cách ghi `remaining` của NVL vào
// phiếu chốt ca MỚI NHẤT — cùng nguồn dữ liệu mà card Hao hụt đọc/ghi, nên số ở
// /ingredients và số chốt ca luôn khớp nhau. Trả null nếu chưa có phiếu chốt nào.
export async function setCounterStock(addressId, ingredient, newRemaining) {
    if (!addressId || !ingredient) return null
    if (!Number.isFinite(newRemaining) || newRemaining < 0) return null
    const remaining = roundStock(newRemaining)
    const applyToReport = (report) => {
        const arr = Array.isArray(report) ? report : []
        let found = false
        const next = arr.map(item => {
            if (item?.ingredient === ingredient) { found = true; return { ...item, remaining } }
            return item
        })
        if (!found) next.push({ ingredient, remaining })
        return next
    }

    if (localRepo.isGuest()) {
        const latest = localRepo.fetchAllLocalShiftClosings(addressId)
            .filter(c => c.inventory_report != null)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        if (!latest) return null
        invalidateReportCache(addressId)
        return localRepo.upsertLocalShiftClosing({ ...latest, inventory_report: applyToReport(latest.inventory_report) })
    }
    if (!supabase) throw new Error('No Supabase connection')

    const { data: latest, error } = await supabase
        .from('shift_closings')
        .select('id, inventory_report')
        .eq('address_id', addressId)
        .not('inventory_report', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    if (error) throw error
    if (!latest) return null

    const { data: row, error: upErr } = await supabase
        .from('shift_closings')
        .update({ inventory_report: applyToReport(latest.inventory_report) })
        .eq('id', latest.id)
        .select()
        .single()
    if (upErr) throw upErr
    invalidateReportCache(addressId)
    return row
}

// Process a restock: updates COGS, ghi nhận invoice + (optional) payment.
//
// opts: {
//   subtotal:        Tổng tiền hàng (giá × qty trước giảm)
//   discount:        Giảm giá (đã quy ra VND ở FE)
//   extraCost:       Chi phí nhập (ship, vận chuyển)
//   paid:            Số tiền trả ngay (default = amountDue = subtotal - discount + extraCost)
//   paymentMethod:   'cash' | 'transfer' cho payment kèm
//   purchaseDate:    ISO string khi user backdate, null = NOW() server
// }
//
// Server tự tính `amount = subtotal − discount + extra`, WAC dùng amount này.
// Trả full mặc định khi `paid` không được truyền (backward-compat với callers cũ).
export async function processIngredientRestock(addressId, ingredient, qty, staffName, opts = {}) {
    const {
        subtotal = 0, discount = 0, extraCost = 0,
        paid = null, paymentMethod = 'cash', purchaseDate = null,
        beforeStock = null, cashPhase = 'post_close',
    } = opts
    // Cờ phân loại dòng tiền lưu cố định trên phiếu. Chỉ 'in_shift' (tiền mặt mua trước
    // chốt ca tiền) mới cộng vào Thực thu; mọi giá trị khác → 'post_close'.
    const phase = cashPhase === 'in_shift' ? 'in_shift' : 'post_close'
    const amountDue = Math.max(0, Number(subtotal) - Number(discount) + Number(extraCost))
    const paidAmount = paid == null ? amountDue : Math.max(0, Math.min(Number(paid), amountDue))
    // Snapshot only on non-RPC paths (guest / default-address). The address RPC
    // computes its own authoritative snapshot inside the same transaction.
    const buildSnapshotMeta = (base) => {
        if (!Number.isFinite(Number(beforeStock))) return base
        const b = roundStock(Number(beforeStock))
        return { ...base, before_stock: b, after_stock: roundStock(b + Number(qty || 0)) }
    }

    let result
    if (localRepo.isGuest()) {
        // 1. Update unit cost (WAC dùng amountDue)
        const unitCost = Number(qty) > 0 ? Math.round(amountDue / Number(qty)) : 0
        await upsertIngredientCost(ingredient, unitCost, addressId)
        // 2. Insert invoice expense (giữ created_at = purchaseDate nếu có)
        const displayName = `Đi chợ: ${ingredient}`
        const invoice = await insertExpense(
            displayName, amountDue, addressId, false, staffName, true, paymentMethod,
            buildSnapshotMeta({ ingredient, qty, subtotal, cash_phase: phase }),
            null, purchaseDate,
            { discount_amount: discount, extra_cost: extraCost }
        )
        // 3. Insert payment nếu có trả tiền
        if (paidAmount > 0 && invoice?.id) {
            await localRepo.insertLocalExpensePayment({
                expense_id: invoice.id,
                address_id: addressId,
                amount: paidAmount,
                payment_method: paymentMethod,
                staff_name: staffName,
                paid_at: purchaseDate || new Date().toISOString(),
            })
        }
        result = { success: true, expense_id: invoice?.id, amount: amountDue, paid: paidAmount, owing: amountDue - paidAmount }
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        if (addressId) {
            const params = {
                p_address_id: addressId,
                p_ingredient: ingredient,
                p_qty: qty,
                p_subtotal: subtotal,
                p_staff_name: staffName,
                p_discount: discount,
                p_extra_cost: extraCost,
                p_initial_payment: paidAmount,
                p_payment_method: paymentMethod,
                p_cash_phase: phase,
            }
            if (purchaseDate) {
                params.p_created_at = purchaseDate
                params.p_paid_at = purchaseDate
            }
            let { data, error } = await supabase.rpc('process_ingredient_restock', params)
            // Pre-migration: RPC chưa có p_cash_phase → PostgREST không khớp overload
            // (PGRST202). Retry bỏ param để nhập kho vẫn chạy (phiếu sẽ thiếu cờ → sau chốt).
            if (error && (error.code === 'PGRST202' || /cash_phase/i.test(error.message || ''))) {
                const retry = { ...params }
                delete retry.p_cash_phase
                ;({ data, error } = await supabase.rpc('process_ingredient_restock', retry))
            }
            if (error) throw error
            result = data
        } else {
            // Default address (template). RPC requires UUID — do the two writes manually so
            // admins can exercise the full restock flow on the global template.
            const unitCost = Number(qty) > 0 ? Math.round(amountDue / Number(qty)) : 0
            await upsertIngredientCost(ingredient, unitCost, null)
            const displayName = `Đi chợ: ${ingredient}`
            const invoice = await insertExpense(
                displayName, amountDue, null, false, staffName, true, paymentMethod,
                buildSnapshotMeta({ ingredient, qty, subtotal, cash_phase: phase }),
                null, purchaseDate,
                { discount_amount: discount, extra_cost: extraCost }
            )
            // Mirror the RPC contract: paid portion lands in expense_payments so the
            // owing math reads the same on the template as on a real address.
            if (paidAmount > 0 && invoice?.id && supabase) {
                // Backdated restock: created_at must match paid_at, else the
                // chk_payment_paid_at_not_before_created constraint rejects the row
                // (created_at would default to NOW() while paid_at is in the past).
                const paidAtISO = purchaseDate || new Date().toISOString()
                await supabase.from('expense_payments').insert({
                    expense_id: invoice.id,
                    address_id: null,
                    amount: paidAmount,
                    payment_method: paymentMethod,
                    staff_name: staffName,
                    paid_at: paidAtISO,
                    created_at: paidAtISO,
                })
            }
            result = { success: true, expense_id: invoice?.id, amount: amountDue, paid: paidAmount, owing: amountDue - paidAmount }
        }
    }
    invalidateReportCache(addressId)
    return result
}

// Sửa một phiếu nhập kho tại chỗ (RPC edit_ingredient_restock)
export async function editIngredientRestock(addressId, expenseId, opts = {}) {
    const {
        qty,
        subtotal,
        discount = 0,
        extraCost = 0,
        paid = null,
        paymentMethod = 'cash',
        purchaseDate = null,
        cashPhase = 'post_close',
        staffName = null
    } = opts

    const amountDue = Math.max(0, Number(subtotal) - Number(discount) + Number(extraCost))
    const paidAmount = paid == null ? amountDue : Math.max(0, Math.min(Number(paid), amountDue))
    const phase = cashPhase === 'in_shift' ? 'in_shift' : 'post_close'

    let result
    if (localRepo.isGuest()) {
        const all = localRepo.fetchAllLocalExpenses(addressId)
        const target = all.find(e => e.id === expenseId)
        if (!target || !target.is_refill) {
            throw new Error('Không phải phiếu nhập kho hợp lệ')
        }
        if (target.metadata?.cancelled) throw new Error('Phiếu đã bị hủy')
        if (target.metadata?.adjustment) throw new Error('Không thể sửa phiếu hiệu chỉnh')

        const ingredient = target.metadata?.ingredient
        const beforeStock = Number(target.metadata?.before_stock) || 0
        const afterStock = beforeStock + Number(qty)

        // 1. Update expense local
        localRepo.updateLocalExpense(expenseId, {
            amount: amountDue,
            discount_amount: discount,
            extra_cost: extraCost,
            payment_method: paymentMethod,
            created_at: purchaseDate || target.created_at,
            metadata: {
                ...target.metadata,
                qty: Number(qty),
                subtotal: Number(subtotal),
                cash_phase: phase,
                after_stock: afterStock
            }
        })

        // 2. Xóa & insert payments local
        localRepo.deleteLocalExpensePaymentsByExpense(expenseId)
        if (paidAmount > 0) {
            await localRepo.insertLocalExpensePayment({
                expense_id: expenseId,
                address_id: addressId,
                amount: paidAmount,
                payment_method: paymentMethod,
                staff_name: staffName,
                paid_at: purchaseDate || target.created_at,
                cash_phase: phase
            })
        }

        // 3. Tính lại WAC local
        const remaining = localRepo.fetchAllLocalExpenses(addressId)
            .filter(e => e.is_refill && e.metadata?.ingredient === ingredient
                && !e.metadata?.adjustment && !e.metadata?.cancelled && e.amount > 0)
        const totalQty = remaining.reduce((s, e) => s + (Number(e.metadata?.qty) || 0), 0)
        const totalCost = remaining.reduce((s, e) => s + (Number(e.amount) || 0), 0)
        
        let newUnitCost = null
        if (totalQty > 0) {
            newUnitCost = Math.round(totalCost / totalQty)
            await upsertIngredientCost(ingredient, newUnitCost, addressId)
            
            // Cập nhật lại new_unit_cost trong metadata
            const updatedTarget = localRepo.fetchAllLocalExpenses(addressId).find(e => e.id === expenseId)
            if (updatedTarget) {
                localRepo.updateLocalExpense(expenseId, {
                    metadata: {
                        ...updatedTarget.metadata,
                        new_unit_cost: newUnitCost
                    }
                })
            }
        }

        result = { success: true, expense_id: expenseId, amount: amountDue, paid: paidAmount, owing: amountDue - paidAmount, new_unit_cost: newUnitCost }
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        const params = {
            p_address_id: addressId,
            p_expense_id: expenseId,
            p_qty: qty,
            p_subtotal: subtotal,
            p_discount: discount,
            p_extra_cost: extraCost,
            p_initial_payment: paidAmount,
            p_payment_method: paymentMethod,
            p_cash_phase: phase,
            p_created_at: purchaseDate || new Date().toISOString(),
            p_staff_name: staffName
        }

        let { data, error } = await supabase.rpc('edit_ingredient_restock', params)
        if (error && (error.code === 'PGRST202' || /cash_phase/i.test(error.message || ''))) {
            const retry = { ...params }
            delete retry.p_cash_phase
            ;({ data, error } = await supabase.rpc('edit_ingredient_restock', retry))
        }
        if (error) throw error
        result = data
    }
    invalidateReportCache(addressId)
    return result
}

// Ghi nhận 1 lần trả nợ cho invoice đã tồn tại (từ Tab Nhật ký của ingredient).
// `paidAt` ISO string — default NOW server-side.
// `cashPhase` 'in_shift' | 'post_close' — phân loại tiền mặt của LẦN TRẢ này
// (độc lập với cờ cash_phase trên hoá đơn gốc lúc nhập kho).
export async function recordInvoicePayment(addressId, expenseId, amount, paymentMethod = 'cash', staffName = null, paidAt = null, cashPhase = null) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        throw new Error('amount must be > 0')
    }
    let result
    if (localRepo.isGuest()) {
        result = await localRepo.insertLocalExpensePayment({
            expense_id: expenseId,
            address_id: addressId,
            amount: Number(amount),
            payment_method: paymentMethod,
            staff_name: staffName,
            paid_at: paidAt || new Date().toISOString(),
            cash_phase: cashPhase,
        })
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        const params = {
            p_expense_id: expenseId,
            p_amount: amount,
            p_payment_method: paymentMethod,
        }
        if (staffName) params.p_staff_name = staffName
        if (paidAt) params.p_paid_at = paidAt
        if (cashPhase) params.p_cash_phase = cashPhase
        const { data, error } = await supabase.rpc('record_invoice_payment', params)
        if (error) throw error
        result = data
    }
    invalidateReportCache(addressId)
    return result
}

// Hủy một phiếu nhập kho HOẶC phiếu hiệu chỉnh tồn → hoàn lại tồn + tiền + giá vốn
// (xem migration cancel_restock). Xóa expense (CASCADE xóa payments → đảo cash-out),
// tính lại WAC từ các phiếu mua thật còn lại, và ghi 1 dòng audit qty=0. Không nhận
// các dòng cancel-marker (metadata.cancel_restock).
export async function cancelRestock(addressId, expenseId, staffName = null) {
    if (!expenseId) throw new Error('expenseId is required')
    let result
    if (localRepo.isGuest()) {
        const all = localRepo.fetchAllLocalExpenses(addressId)
        const target = all.find(e => e.id === expenseId)
        if (!target || !target.is_refill) {
            throw new Error('Không phải phiếu nhập kho / hiệu chỉnh hợp lệ')
        }
        if (target.metadata?.cancelled) throw new Error('Phiếu đã bị hủy')
        const ingredient = target.metadata?.ingredient
        const cancelledQty = Number(target.metadata?.qty) || 0
        const cancelledAmount = Number(target.amount) || 0
        const wasAdjustment = !!target.metadata?.adjustment
        // 1. Zero-out tại chỗ + cờ cancelled (giữ dòng trong nhật ký). Số gốc cất trong metadata.
        localRepo.updateLocalExpense(expenseId, {
            amount: 0,
            metadata: {
                ...target.metadata,
                qty: 0,
                cancelled: true,
                cancelled_at: new Date().toISOString(),
                cancelled_by: staffName,
                cancelled_qty: cancelledQty,
                cancelled_amount: cancelledAmount,
            },
        })
        // 2. Xóa payments của phiếu (đảo cash-out).
        localRepo.deleteLocalExpensePaymentsByExpense(expenseId)
        // 3. Tính lại WAC từ các phiếu mua thật còn lại (loại adjustment + cancelled + amount 0).
        const remaining = localRepo.fetchAllLocalExpenses(addressId)
            .filter(e => e.is_refill && e.metadata?.ingredient === ingredient
                && !e.metadata?.adjustment && !e.metadata?.cancelled && e.amount > 0)
        const totalQty = remaining.reduce((s, e) => s + (Number(e.metadata?.qty) || 0), 0)
        const totalCost = remaining.reduce((s, e) => s + (Number(e.amount) || 0), 0)
        if (totalQty > 0) {
            await upsertIngredientCost(ingredient, Math.round(totalCost / totalQty), addressId)
        }
        result = { success: true, ingredient, cancelled_qty: cancelledQty, was_adjustment: wasAdjustment }
    } else {
        if (!supabase) throw new Error('No Supabase connection')
        const params = { p_address_id: addressId, p_expense_id: expenseId }
        if (staffName) params.p_staff_name = staffName
        const { data, error } = await supabase.rpc('cancel_restock', params)
        if (error) throw error
        result = data
    }
    invalidateReportCache(addressId)
    return result
}
