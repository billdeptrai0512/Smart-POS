import { supabase } from '../lib/supabaseClient'

/**
 * Clone all address-specific config from source → target.
 * Each step uses delete-then-insert (overwrite), so retry is safe.
 *
 * options = { menu, prices, ingredients, recipes, extras }  (all default true)
 */
export async function cloneAddressConfig(sourceAddressId, targetAddressId, options = {}) {
    if (!supabase) throw new Error('No Supabase connection')

    const opts = {
        menu: true,
        prices: true,
        ingredients: true,
        recipes: true,
        extras: true,
        ...options,
    }

    // ── 1. address_products (menu structure + sort order) ──────────────────
    if (opts.menu) {
        const { data: srcProds, error } = await supabase
            .from('address_products')
            .select('product_id, sort_order')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc menu nguồn: ' + error.message)

        if (srcProds?.length) {
            const { error: delErr } = await supabase
                .from('address_products')
                .delete()
                .eq('address_id', targetAddressId)
            if (delErr) throw new Error('Lỗi khi xóa menu cũ: ' + delErr.message)

            const rows = srcProds.map(p => ({
                address_id: targetAddressId,
                product_id: p.product_id,
                sort_order: p.sort_order,
            }))
            const { error: insErr } = await supabase.from('address_products').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu menu: ' + insErr.message)
        }
    }

    // ── 2. product_prices (giá override per address) ───────────────────────
    if (opts.prices) {
        const { data: srcPrices, error } = await supabase
            .from('product_prices')
            .select('product_id, price')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc giá menu nguồn: ' + error.message)

        await supabase.from('product_prices').delete().eq('address_id', targetAddressId)

        if (srcPrices?.length) {
            const rows = srcPrices.map(p => ({
                address_id: targetAddressId,
                product_id: p.product_id,
                price: p.price,
            }))
            const { error: insErr } = await supabase.from('product_prices').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu giá menu: ' + insErr.message)
        }
    }

    // ── 3. ingredient_costs + ingredient_sort_order ────────────────────────
    if (opts.ingredients) {
        const { data: srcCosts, error } = await supabase
            .from('ingredient_costs')
            .select('ingredient, unit_cost, unit')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc nguyên liệu nguồn: ' + error.message)

        await supabase.from('ingredient_costs').delete().eq('address_id', targetAddressId)

        if (srcCosts?.length) {
            const rows = srcCosts.map(c => ({
                address_id: targetAddressId,
                ingredient: c.ingredient,
                unit_cost: c.unit_cost,
                unit: c.unit,
            }))
            const { error: insErr } = await supabase.from('ingredient_costs').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu nguyên liệu: ' + insErr.message)
        }

        // Copy ingredient_sort_order field from source address object
        const { data: srcAddr } = await supabase
            .from('addresses')
            .select('ingredient_sort_order')
            .eq('id', sourceAddressId)
            .single()
        if (srcAddr?.ingredient_sort_order) {
            await supabase
                .from('addresses')
                .update({ ingredient_sort_order: srcAddr.ingredient_sort_order })
                .eq('id', targetAddressId)
        }
    }

    // ── 4. recipes (address-specific overrides only) ───────────────────────
    if (opts.recipes) {
        const { data: srcRecipes, error } = await supabase
            .from('recipes')
            .select('product_id, ingredient, amount, unit')
            .eq('address_id', sourceAddressId)
        if (error) throw new Error('Lỗi khi đọc công thức nguồn: ' + error.message)

        await supabase.from('recipes').delete().eq('address_id', targetAddressId)

        if (srcRecipes?.length) {
            const rows = srcRecipes.map(r => ({
                address_id: targetAddressId,
                product_id: r.product_id,
                ingredient: r.ingredient,
                amount: r.amount,
                unit: r.unit,
            }))
            const { error: insErr } = await supabase.from('recipes').insert(rows)
            if (insErr) throw new Error('Lỗi khi sao lưu công thức: ' + insErr.message)
        }
    }

    // ── 5. product_extras + extra_ingredients (with old→new ID mapping) ────
    if (opts.extras) {
        const { data: srcExtras, error: extrasErr } = await supabase
            .from('product_extras')
            .select('id, product_id, name, price, sort_order, is_sticky')
            .eq('address_id', sourceAddressId)
        if (extrasErr) throw new Error('Lỗi khi đọc tùy chọn nguồn: ' + extrasErr.message)

        // extra_ingredients has no ON DELETE CASCADE from product_extras in schema,
        // so we must delete child rows explicitly before deleting the parent extras.
        const { data: existingExtras } = await supabase
            .from('product_extras')
            .select('id')
            .eq('address_id', targetAddressId)

        if (existingExtras?.length) {
            const ids = existingExtras.map(e => e.id)
            await supabase.from('extra_ingredients').delete().in('extra_id', ids)
            await supabase.from('product_extras').delete().in('id', ids)
        }

        if (srcExtras?.length) {
            // Fetch all extra_ingredients for source extras in one query
            const srcIds = srcExtras.map(e => e.id)
            const { data: srcIngs } = await supabase
                .from('extra_ingredients')
                .select('extra_id, ingredient, amount, unit')
                .in('extra_id', srcIds)

            const ingsByExtraId = {}
            for (const ing of srcIngs || []) {
                if (!ingsByExtraId[ing.extra_id]) ingsByExtraId[ing.extra_id] = []
                ingsByExtraId[ing.extra_id].push(ing)
            }

            // Batch-insert all extras in one request, SELECT returns rows in insertion order
            // so we can zip srcExtras[i] → newExtras[i] to build the old→new ID map
            const extraRows = srcExtras.map(e => ({
                address_id: targetAddressId,
                product_id: e.product_id,
                name: e.name,
                price: e.price,
                sort_order: e.sort_order,
                is_sticky: e.is_sticky,
            }))
            const { data: newExtras, error: insErr } = await supabase
                .from('product_extras')
                .insert(extraRows)
                .select('id')
            if (insErr) throw new Error('Lỗi khi sao lưu tùy chọn: ' + insErr.message)

            // Build old→new ID map from positional zip
            const idMap = new Map()
            srcExtras.forEach((old, i) => idMap.set(old.id, newExtras[i].id))

            // Batch-insert all extra_ingredients in one request
            const allIngRows = []
            for (const [oldId, ings] of Object.entries(ingsByExtraId)) {
                const newId = idMap.get(oldId)
                if (!newId) continue
                for (const ing of ings) {
                    allIngRows.push({ extra_id: newId, ingredient: ing.ingredient, amount: ing.amount, unit: ing.unit })
                }
            }
            if (allIngRows.length) {
                const { error: ingErr } = await supabase.from('extra_ingredients').insert(allIngRows)
                if (ingErr) throw new Error('Lỗi khi sao lưu định lượng tùy chọn: ' + ingErr.message)
            }
        }
    }
}
