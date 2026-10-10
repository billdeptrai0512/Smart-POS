import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row, SupabaseError } from '../types/domain'

// Fetch ingredient costs + units in one query, return both shapes
export async function fetchIngredientCostsAndUnits(addressId: UUID | null) {
    if (localRepo.isGuest()) {
        const rows = localRepo.fetchLocalIngredientCosts(addressId)
        const costs: Row = {}, units: Row = {}
        rows.forEach((r: Row) => {
            costs[r.ingredient] = r.unit_cost
            units[r.ingredient] = r.unit
        })
        // ponytail: guest không có nhóm nguyên liệu (groups null = không hỗ trợ) — thêm khi guest cần chia nhóm.
        return { costs, units, rows, groups: null }
    }
    // ingredient_costs is now per-address (like products/recipes). Default rows
    // (address_id IS NULL) are a one-time seed/template — copied to each new
    // address via the seed_address_ingredient_costs trigger and the backfill in
    // migration 20260518_decouple_ingredient_costs.sql. Admin edits to default
    // rows DO NOT propagate to existing active addresses.
    const groupsPromise = fetchIngredientGroups(addressId)
    const cols = 'ingredient, unit_cost, unit, address_id, pack_size, pack_unit, pack2_size, pack2_unit, min_stock, min_counter_stock, category, count_in_audit, tare_weight, group_id'
    const q = supabase.from('ingredient_costs').select<string, Row>(cols) // cols là chuỗi động → khai báo hình dạng hàng, nếu không supabase-js rơi về GenericStringError
    const { data, error } = await (addressId ? q.eq('address_id', addressId) : q.is('address_id', null))
    const groups = await groupsPromise
    if (error) {
        // Ném (không trả rỗng): ProductContext giữ cache + retry, thay vì ghi đè giá vốn/quy cách bằng {} rồi cache luôn.
        console.error('fetchIngredientCostsAndUnits error:', error)
        throw error
    }
    if (!data || data.length === 0) return { costs: {}, units: {}, rows: [], groups }

    const costs: Row = {}
    const units: Row = {}
    const rows: Row[] = []
    for (const d of data) {
        costs[d.ingredient] = d.unit_cost
        units[d.ingredient] = d.unit || 'đv'
        rows.push({ ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost, pack_size: d.pack_size, pack_unit: d.pack_unit, pack2_size: d.pack2_size ?? null, pack2_unit: d.pack2_unit ?? null, min_stock: d.min_stock, min_counter_stock: d.min_counter_stock ?? null, category: d.category || null, count_in_audit: d.count_in_audit ?? true, tare_weight: d.tare_weight ?? null, group_id: d.group_id ?? null })
    }
    return { costs, units, rows, groups }
}

// Nhóm nguyên liệu (danh mục con trong tab Nguyên liệu / Bao bì) — migration 20261003_ingredient_groups.
// null = địa chỉ không hỗ trợ nhóm (template address null / bảng chưa migrate) → UI ẩn phần nhóm.
async function fetchIngredientGroups(addressId: UUID | null): Promise<Row[] | null> {
    if (!addressId) return null
    const { data, error } = await supabase
        .from('ingredient_groups')
        .select('id, name, section, sort_order')
        .eq('address_id', addressId)
        .order('sort_order')
        .order('created_at')
    if (error) {
        console.error('fetchIngredientGroups error:', error)
        return null
    }
    return data || []
}

export async function createIngredientGroup(addressId: UUID, name: string, section: 'main' | 'packaging', sortOrder: number) {
    const { data, error } = await supabase
        .from('ingredient_groups')
        .insert({ address_id: addressId, name: name.trim(), section, sort_order: sortOrder })
        .select('id, name, section, sort_order')
        .single()
    if (error) throw error
    return data
}

export async function renameIngredientGroup(id: UUID, name: string) {
    const { error } = await supabase.from('ingredient_groups').update({ name: name.trim() }).eq('id', id)
    if (error) throw error
}

// Nguyên liệu trong nhóm rơi về "Chưa phân nhóm" (FK ON DELETE SET NULL).
export async function deleteIngredientGroup(id: UUID) {
    const { error } = await supabase.from('ingredient_groups').delete().eq('id', id)
    if (error) throw error
}

// Gán nhóm + tab cho 1 hay nhiều nguyên liệu bằng 1 lệnh UPDATE (trigger sync_ingredient_group_category
// ép category = section khi có nhóm; bỏ món khỏi nhóm (groupId null) thì category giữ nguyên).
// UPDATE thay vì upsert để không phải mang theo unit_cost — nguyên liệu đã có dòng ingredient_costs.
export async function setIngredientsGroup(ingredients: string[], addressId: UUID, groupId: UUID | null) {
    if (ingredients.length === 0) return
    const { error } = await supabase
        .from('ingredient_costs')
        .update({ group_id: groupId })
        .eq('address_id', addressId)
        .in('ingredient', ingredients)
    if (error) throw error
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
    const sb = supabase

    const payload: Row = { ingredient, unit_cost: unitCost }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    // `??` so an explicit 0 / '' passed by the UI is preserved.
    // Caller passes null/undefined when intentionally clearing the field.
    if (opts.packSize !== undefined) payload.pack_size = opts.packSize ?? null
    if (opts.packUnit !== undefined) payload.pack_unit = opts.packUnit ?? null
    if (opts.pack2Size !== undefined) payload.pack2_size = opts.pack2Size ?? null
    if (opts.pack2Unit !== undefined) payload.pack2_unit = opts.pack2Unit ?? null
    if (opts.minStock !== undefined) payload.min_stock = opts.minStock ?? null
    if (opts.minCounterStock !== undefined) payload.min_counter_stock = opts.minCounterStock ?? null
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
