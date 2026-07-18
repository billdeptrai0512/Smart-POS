import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row } from '../types/domain'

type SupabaseError = { code?: string; message?: string } | null

// Fetch ingredient costs + units in one query, return both shapes
export async function fetchIngredientCostsAndUnits(addressId: UUID | null) {
    if (localRepo.isGuest()) {
        const rows = localRepo.fetchLocalIngredientCosts(addressId)
        const costs: Row = {}, units: Row = {}
        rows.forEach((r: Row) => {
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
    const runQuery = async (cols: string) => {
        if (!supabase) return { data: null, error: null } as { data: Row[] | null; error: SupabaseError }
        let q = supabase.from('ingredient_costs').select(cols)
        q = addressId ? q.eq('address_id', addressId) : q.is('address_id', null)
        // .select(cols) with a dynamic column string (not a literal) makes supabase-js
        // fall back to its GenericStringError type — cast to the real loose shape.
        return await q as unknown as { data: Row[] | null; error: SupabaseError }
    }

    // Try newest schema first, degrade column-by-column on undefined_column (42703)
    // so the page still loads if tare_weight / count_in_audit / category migrations
    // aren't deployed.
    let { data, error } = await runQuery(`${BASE}, category, count_in_audit, tare_weight`)
    if (error?.code === '42703') ({ data, error } = await runQuery(`${BASE}, category, count_in_audit`))
    if (error?.code === '42703') ({ data, error } = await runQuery(`${BASE}, category`))
    if (error?.code === '42703') ({ data, error } = await runQuery(BASE))
    if (error) {
        console.error('fetchIngredientCostsAndUnits error:', error)
        return { costs: {}, units: {}, rows: [] }
    }
    if (!data || data.length === 0) return { costs: {}, units: {}, rows: [] }

    const costs: Row = {}
    const units: Row = {}
    const rows: Row[] = []
    for (const d of data) {
        costs[d.ingredient] = d.unit_cost
        units[d.ingredient] = d.unit || 'đv'
        rows.push({ ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost, pack_size: d.pack_size, pack_unit: d.pack_unit, min_stock: d.min_stock, category: d.category || null, count_in_audit: d.count_in_audit ?? true, tare_weight: d.tare_weight ?? null })
    }
    return { costs, units, rows }
}

// Kept for backward-compat — delegates to fetchIngredientCostsAndUnits
export async function fetchIngredientCostsWithUnits(addressId: UUID | null) {
    const { rows } = await fetchIngredientCostsAndUnits(addressId)
    return rows
}

// Upsert an ingredient cost
export async function upsertIngredientCost(ingredient: string, unitCost: number, addressId: UUID | null = null, unit: string | null = null, opts: Row = {}) {
    // unit defaults to null when the caller only wants to touch unit_cost (e.g.
    // processIngredientRestock never passes it) — must stay OUT of the guest payload
    // entirely (like the Supabase branch below already does via `if (unit) ...`), or
    // upsertLocalIngredientCost's merge will wipe the ingredient's already-stored unit.
    if (localRepo.isGuest()) return localRepo.upsertLocalIngredientCost({ ingredient, unit_cost: unitCost, address_id: addressId, ...(unit ? { unit } : {}), ...opts })
    if (!supabase) throw new Error('No Supabase connection')
    const sb = supabase

    const payload: Row = { ingredient, unit_cost: unitCost }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    // `??` so an explicit 0 / '' passed by the UI is preserved.
    // Caller passes null/undefined when intentionally clearing the field.
    if (opts.packSize !== undefined) payload.pack_size = opts.packSize ?? null
    if (opts.packUnit !== undefined) payload.pack_unit = opts.packUnit ?? null
    if (opts.minStock !== undefined) payload.min_stock = opts.minStock ?? null
    if (opts.category !== undefined) payload.category = opts.category ?? null
    if (opts.countInAudit !== undefined) payload.count_in_audit = !!opts.countInAudit
    if (opts.tareWeight !== undefined) payload.tare_weight = opts.tareWeight ?? null

    const upsert = (body: Row) => sb
        .from('ingredient_costs')
        .upsert(body, { onConflict: 'ingredient,address_id' })
    // PostgREST trả PGRST204 ("could not find column in schema cache") khi WRITE cột
    // chưa migrate; Postgres trả 42703. Bắt cả hai + dò tên cột để degrade an toàn.
    const missingCol = (error: SupabaseError, col: string) =>
        !!error && (error.code === 'PGRST204' || error.code === '42703' || new RegExp(col).test(error.message || ''))

    // Degrade dần nếu cột optional chưa migrate: bỏ từng cột (mới nhất trước) rồi thử lại.
    let body: Row = payload
    let { error } = await upsert(body)
    for (const col of ['tare_weight', 'count_in_audit', 'category']) {
        if (!error) break
        if (!missingCol(error, col) || !(col in body)) continue
        const { [col]: _drop, ...rest } = body
        body = rest
        ;({ error } = await upsert(body))
    }
    if (error) throw error
}

// Sửa giá vốn thủ công — đi qua RPC (không upsert thẳng) để giá vốn fan-out đúng khi địa chỉ
// thuộc 1 warehouse group dùng chung kho tổng (xem set_ingredient_unit_cost). Guest/local mode
// không có khái niệm nhóm nên giữ nguyên đường upsert local cũ.
export async function updateIngredientUnitCost(ingredient: string, unitCost: number, addressId: UUID) {
    if (localRepo.isGuest()) return localRepo.upsertLocalIngredientCost({ ingredient, unit_cost: unitCost, address_id: addressId })
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.rpc('set_ingredient_unit_cost', { p_address_id: addressId, p_ingredient: ingredient, p_unit_cost: unitCost })
    if (error) throw error
}

// Sync (rename or merge) an ingredient key across ingredient_costs, recipes,
// shift_closings.inventory_report (JSONB), and expenses.metadata (JSONB).
// Always-merge mode: if newKey already exists in ingredient_costs for this address,
// the oldKey row is deleted (newKey kept as canonical). See migration 20260519.
//
// Returns: { recipes_updated, closings_updated, expenses_updated, costs_action }
//   costs_action ∈ 'renamed' | 'merged' | 'none' | 'noop'
export async function syncIngredientKey(addressId: UUID, oldKey: string, newKey: string) {
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
export async function renameIngredient(oldKey: string, newKey: string, addressId: UUID) {
    return await syncIngredientKey(addressId, oldKey, newKey)
}

// Delete an ingredient cost entry — also cleans recipes + extra_ingredients for this address.
// Uses the delete_ingredient RPC for atomic cleanup across all tables.
export async function deleteIngredientCost(ingredient: string, addressId: UUID | null = null) {
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
