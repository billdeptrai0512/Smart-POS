import { supabase } from '../lib/supabaseClient'

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
 * options = { menu, recipes, extras, ingredients }   (all default true)
 * onProgress = ({ phase, count }) => void   (phase: 'menu' | 'recipes' | 'extras' | 'ingredients')
 */
export async function cloneAddressConfig(sourceAddressId, targetAddressId, options = {}, onProgress) {
    if (!supabase) throw new Error('No Supabase connection')

    const opts = {
        menu: true,
        recipes: true,
        extras: true,
        ingredients: true,
        ...options,
    }
    const emit = (phase, count) => { try { onProgress?.({ phase, count }) } catch { /* never let UI bug break clone */ } }

    const productIdMap = new Map() // source product id → target product id

    // ── 1. Menu = products (price + sort_order + count_as_cup live on this row) ─────
    if (opts.menu) {
        const { data: srcProducts, error } = await supabase
            .from('products')
            .select('id, name, price, sort_order, count_as_cup, is_active')
            .eq('owner_address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc menu nguồn: ' + error.message)

        const list = srcProducts || []
        emit('menu', list.length)

        if (list.length) {
            const rows = list.map(p => {
                const newId = crypto.randomUUID()
                productIdMap.set(p.id, newId)
                return {
                    id: newId,
                    name: p.name,
                    price: p.price,
                    sort_order: p.sort_order,
                    count_as_cup: p.count_as_cup ?? true,
                    is_active: p.is_active ?? true,
                    owner_address_id: targetAddressId,
                }
            })
            const { error: insErr } = await supabase.from('products').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu menu: ' + insErr.message)
        }
    }

    // ── 2. Recipes (per-address overrides; globals are shared and inherited automatically) ──
    if (opts.recipes && productIdMap.size > 0) {
        const { data: srcRecipes, error } = await supabase
            .from('recipes')
            .select('product_id, ingredient, amount, unit')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc công thức nguồn: ' + error.message)

        const rows = (srcRecipes || [])
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
        const { data: srcExtras, error } = await supabase
            .from('product_extras')
            .select('id, product_id, name, price, sort_order, is_sticky')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc tùy chọn nguồn: ' + error.message)

        const extraIdMap = new Map()
        const extraRows = []
        for (const e of srcExtras || []) {
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

            const { data: srcIngs, error: ingErr } = await supabase
                .from('extra_ingredients')
                .select('extra_id, ingredient, amount, unit')
                .in('extra_id', Array.from(extraIdMap.keys()))
            if (ingErr) throw new Error('Lỗi khi đọc định lượng tùy chọn: ' + ingErr.message)

            const ingRows = (srcIngs || [])
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
        const { data: srcCosts, error } = await supabase
            .from('ingredient_costs')
            .select('ingredient, unit_cost, unit')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc nguyên liệu nguồn: ' + error.message)

        const list = srcCosts || []
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

        const { data: srcAddr, error: addrErr } = await supabase
            .from('addresses')
            .select('ingredient_sort_order')
            .eq('id', sourceAddressId)
            .single()
        if (addrErr) throw new Error('Lỗi khi đọc thứ tự nguyên liệu: ' + addrErr.message)

        const sortOrder = srcAddr?.ingredient_sort_order
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
        try { localStorage.removeItem(`cache_${name}_${targetAddressId}`) } catch { /* ignore */ }
    }

    return { productCount: productIdMap.size }
}
