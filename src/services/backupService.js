import { supabase } from '../lib/supabaseClient'
import { cacheKey as buildCacheKey } from '../constants/storageKeys'

/**
 * Clone full address setup from source → target (NEW address only).
 *
 * Data model (per commit 43af730 "new design of database product on address"):
 *   - products.owner_address_id is the per-address identity (each address has its own clone of every product)
 *   - product_prices and address_products tables are no longer used
 *   - recipes / product_extras link to products by id, so cloning requires an old→new product id map
 *
 * Strategy: client-generate UUIDs so the id map is known *before* the INSERT, then batch-insert
 * everything in one round-trip per table. Avoids the per-row INSERT...RETURNING dance and the fact
 * that PostgreSQL doesn't guarantee RETURNING preserves input order.
 *
 * Two entry points share the same WRITE path (`applySnapshot`):
 *   - cloneAddressConfig — same-account: reads source (RLS-scoped), then writes.
 *   - cloneFromShareCode — cross-account: reads source via get_shared_config RPC
 *     (SECURITY DEFINER, authorized by share code), then writes.
 *
 * options = { menu, recipes, extras, ingredients }   (all default true)
 * onProgress = ({ phase, count }) => void   (phase: 'menu' | 'recipes' | 'extras' | 'ingredients')
 */

// Snapshot shape (source ids preserved so id-map logic works on write):
//   { products:[{id,name,price,sort_order,count_as_cup}],
//     recipes:[{product_id,ingredient,amount,unit}],
//     extras:[{id,product_id,name,price,sort_order,is_sticky}],
//     extraIngredients:[{extra_id,ingredient,amount,unit}],
//     costs:[{ingredient,unit_cost,unit}],
//     ingredientSortOrder:[...] }

// Read a source address (RLS-scoped to current user) into a snapshot.
async function readSnapshot(sourceAddressId) {
    let { data: products, error: e1 } = await supabase
        .from('products')
        .select('id, name, price, sort_order, count_as_cup, is_divider')
        .eq('owner_address_id', sourceAddressId)
        .eq('is_active', true)
    // 42703: cột is_divider chưa có (migration 20260703_menu_divider chưa chạy)
    let hasDividerColumn = true
    if (e1?.code === '42703') {
        hasDividerColumn = false
        ({ data: products, error: e1 } = await supabase
            .from('products')
            .select('id, name, price, sort_order, count_as_cup')
            .eq('owner_address_id', sourceAddressId)
            .eq('is_active', true))
    }
    if (e1) throw new Error('Lỗi khi đọc menu nguồn: ' + e1.message)

    const { data: recipes, error: e2 } = await supabase
        .from('recipes')
        .select('product_id, ingredient, amount, unit')
        .eq('address_id', sourceAddressId)
    if (e2) throw new Error('Lỗi khi đọc công thức nguồn: ' + e2.message)

    const { data: extras, error: e3 } = await supabase
        .from('product_extras')
        .select('id, product_id, name, price, sort_order, is_sticky')
        .eq('address_id', sourceAddressId)
    if (e3) throw new Error('Lỗi khi đọc tùy chọn nguồn: ' + e3.message)

    let extraIngredients = []
    const extraIds = (extras || []).map(e => e.id)
    if (extraIds.length) {
        const { data: ei, error: e4 } = await supabase
            .from('extra_ingredients')
            .select('extra_id, ingredient, amount, unit')
            .in('extra_id', extraIds)
        if (e4) throw new Error('Lỗi khi đọc định lượng tùy chọn: ' + e4.message)
        extraIngredients = ei || []
    }

    const { data: costs, error: e5 } = await supabase
        .from('ingredient_costs')
        .select('ingredient, unit_cost, unit')
        .eq('address_id', sourceAddressId)
    if (e5) throw new Error('Lỗi khi đọc nguyên liệu nguồn: ' + e5.message)

    const { data: srcAddr, error: e6 } = await supabase
        .from('addresses')
        .select('ingredient_sort_order')
        .eq('id', sourceAddressId)
        .single()
    if (e6) throw new Error('Lỗi khi đọc thứ tự nguyên liệu: ' + e6.message)

    return {
        products: products || [],
        recipes: recipes || [],
        extras: extras || [],
        extraIngredients,
        costs: costs || [],
        ingredientSortOrder: srcAddr?.ingredient_sort_order || [],
        hasDividerColumn,
    }
}

// Write a snapshot into a freshly-created target address.
async function applySnapshot(targetAddressId, snapshot, options, onProgress) {
    const opts = { menu: true, recipes: true, extras: true, ingredients: true, ...options }
    const emit = (phase, count) => { try { onProgress?.({ phase, count }) } catch { /* never let UI bug break clone */ } }

    const productIdMap = new Map() // source product id → target product id

    // ── 0. Wipe any pre-existing data at target ───────────────────────────────────
    // Why: a Postgres trigger seeds every new address with a default menu (products +
    // recipes). If we just append clone results, the new address ends up with
    // defaults + clone instead of clone only. Safe to hard-delete here because the
    // target address was created seconds ago and has no order_items yet.
    //
    // Delete order matters: extra_ingredients ← product_extras (CASCADE) and
    // recipes ← products (CASCADE), so deleting products + product_extras handles
    // their children. ingredient_costs is independent.
    {
        const { error: e1 } = await supabase.from('product_extras').delete().eq('address_id', targetAddressId)
        if (e1) throw new Error('Lỗi khi dọn tùy chọn cũ ở địa chỉ mới: ' + e1.message)

        const { error: e2 } = await supabase.from('products').delete().eq('owner_address_id', targetAddressId)
        if (e2) throw new Error('Lỗi khi dọn menu cũ ở địa chỉ mới: ' + e2.message)

        // recipes cascades from products, but the trigger may also seed address-scoped
        // recipes that reference shared/global products; clean those up too.
        const { error: e3 } = await supabase.from('recipes').delete().eq('address_id', targetAddressId)
        if (e3) throw new Error('Lỗi khi dọn công thức cũ ở địa chỉ mới: ' + e3.message)

        const { error: e4 } = await supabase.from('ingredient_costs').delete().eq('address_id', targetAddressId)
        if (e4) throw new Error('Lỗi khi dọn nguyên liệu cũ ở địa chỉ mới: ' + e4.message)
    }

    // ── 1. Menu = products (price + sort_order + count_as_cup live on this row) ─────
    if (opts.menu) {
        const list = snapshot.products || []
        emit('menu', list.length)

        if (list.length) {
            // Cột is_divider phải nhất quán trên MỌI row: PostgREST dựng câu INSERT theo
            // union các key trong mảng, row nào thiếu key sẽ nhận NULL (không fallback
            // default false) → vi phạm NOT NULL nếu chỉ vài row có divider (xem lỗi
            // "null value in column is_divider"). Nên gửi cho tất cả hoặc không gửi cho ai.
            const hasDivider = snapshot.hasDividerColumn !== false
            const rows = list.map(p => {
                const newId = crypto.randomUUID()
                productIdMap.set(p.id, newId)
                return {
                    id: newId,
                    name: p.name,
                    price: p.price,
                    sort_order: p.sort_order,
                    count_as_cup: p.count_as_cup ?? true,
                    is_active: true,
                    owner_address_id: targetAddressId,
                    ...(hasDivider ? { is_divider: p.is_divider ?? false } : {}),
                }
            })
            const { error: insErr } = await supabase.from('products').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu menu: ' + insErr.message)
        }
    }

    // ── 2. Recipes (per-address overrides; globals are shared and inherited automatically) ──
    if (opts.recipes && productIdMap.size > 0) {
        const rows = (snapshot.recipes || [])
            .map(r => {
                const newPid = productIdMap.get(r.product_id)
                if (!newPid) return null
                return {
                    product_id: newPid,
                    ingredient: r.ingredient,
                    amount: r.amount,
                    unit: r.unit,
                    address_id: targetAddressId,
                }
            })
            .filter(Boolean)

        emit('recipes', rows.length)
        if (rows.length) {
            const { error: insErr } = await supabase.from('recipes').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu công thức: ' + insErr.message)
        }
    }

    // ── 3. Extras = product_extras + extra_ingredients (need product idMap and extra idMap) ──
    if (opts.extras && productIdMap.size > 0) {
        const extraIdMap = new Map()
        const extraRows = []
        for (const e of snapshot.extras || []) {
            const newPid = productIdMap.get(e.product_id)
            if (!newPid) continue
            const newId = crypto.randomUUID()
            extraIdMap.set(e.id, newId)
            extraRows.push({
                id: newId,
                product_id: newPid,
                name: e.name,
                price: e.price,
                sort_order: e.sort_order,
                is_sticky: e.is_sticky ?? false,
                address_id: targetAddressId,
            })
        }

        emit('extras', extraRows.length)
        if (extraRows.length) {
            const { error: insErr } = await supabase.from('product_extras').insert(extraRows)
            if (insErr) throw new Error('Lỗi khi sao lưu tùy chọn: ' + insErr.message)

            const ingRows = (snapshot.extraIngredients || [])
                .map(i => ({
                    extra_id: extraIdMap.get(i.extra_id),
                    ingredient: i.ingredient,
                    amount: i.amount,
                    unit: i.unit,
                }))
                .filter(r => r.extra_id)

            if (ingRows.length) {
                const { error: insErr2 } = await supabase.from('extra_ingredients').insert(ingRows)
                if (insErr2) throw new Error('Lỗi khi sao lưu định lượng tùy chọn: ' + insErr2.message)
            }
        }
    }

    // ── 4. Ingredients = ingredient_costs overrides + ingredient_sort_order ─────────
    if (opts.ingredients) {
        const list = snapshot.costs || []
        emit('ingredients', list.length)

        if (list.length) {
            const rows = list.map(c => ({
                address_id: targetAddressId,
                ingredient: c.ingredient,
                unit_cost: c.unit_cost,
                unit: c.unit,
            }))
            const { error: insErr } = await supabase.from('ingredient_costs').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu nguyên liệu: ' + insErr.message)
        }

        const sortOrder = snapshot.ingredientSortOrder
        if (Array.isArray(sortOrder) && sortOrder.length > 0) {
            const { error: updErr } = await supabase
                .from('addresses')
                .update({ ingredient_sort_order: sortOrder })
                .eq('id', targetAddressId)
            if (updErr) throw new Error('Lỗi khi sao lưu thứ tự nguyên liệu: ' + updErr.message)
        }
    }

    // Invalidate any stale prefetch cache for the target address. AddressSelectPage's prefetch
    // effect fires the moment the new address row appears, which races against this clone — if
    // prefetch wins, it stores empty arrays under cache_*_${targetId}. Clearing here forces
    // ProductContext to network-fetch on next /pos mount, which gets the correct data.
    for (const name of ['products', 'recipes', 'costs', 'units', 'extras', 'extra_ingredients']) {
        try { localStorage.removeItem(buildCacheKey(targetAddressId, name)) } catch { /* ignore */ }
    }

    return { productCount: productIdMap.size }
}

export async function cloneAddressConfig(sourceAddressId, targetAddressId, options = {}, onProgress) {
    if (!supabase) throw new Error('No Supabase connection')
    const snapshot = await readSnapshot(sourceAddressId)
    return applySnapshot(targetAddressId, snapshot, options, onProgress)
}

/**
 * Cross-account clone: read source config via share code (RPC bypasses RLS),
 * write into target (owned by caller), then record referral attribution.
 */
export async function cloneFromShareCode(code, targetAddressId, onProgress) {
    if (!supabase) throw new Error('No Supabase connection')

    const { data, error } = await supabase.rpc('get_shared_config', { p_code: code })
    if (error) throw new Error(error.message || 'Mã không hợp lệ')
    if (!data) throw new Error('Mã không hợp lệ hoặc đã hết hạn')

    const snapshot = {
        products: data.products || [],
        recipes: data.recipes || [],
        extras: data.extras || [],
        extraIngredients: data.extra_ingredients || [],
        costs: data.costs || [],
        ingredientSortOrder: data.ingredient_sort_order || [],
    }

    const result = await applySnapshot(targetAddressId, snapshot, {}, onProgress)

    // Referral attribution (best-effort — clone already succeeded, don't fail on this).
    if (data.source_address_id) {
        try {
            await supabase
                .from('addresses')
                .update({ referred_from_address_id: data.source_address_id })
                .eq('id', targetAddressId)
        } catch { /* attribution is non-critical */ }
    }

    return result
}

/**
 * Read-only peek at a share code's config — for the "what will I copy" preview.
 * Returns the snapshot data, or null if the code is invalid/expired.
 */
export async function getSharedConfig(code) {
    if (!supabase || !code) return null
    const { data, error } = await supabase.rpc('get_shared_config', { p_code: code })
    if (error || !data) return null
    return data
}

/** Generate (or reuse) a share code for an address the caller owns. */
export async function createAddressShareCode(addressId) {
    if (!supabase) throw new Error('No Supabase connection')
    const { data, error } = await supabase.rpc('create_address_share_code', { p_address_id: addressId })
    if (error) throw new Error(error.message || 'Không thể tạo mã')
    return data
}
