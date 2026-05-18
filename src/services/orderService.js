import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'



// Fetch all products for the menu (purely branch isolated)
export async function fetchProducts(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalProducts(addressId)
    if (!supabase) return []

    let query = supabase.from('products').select('id, name, price, is_active, owner_address_id, sort_order, count_as_cup').eq('is_active', true)

    if (addressId) {
        query = query.eq('owner_address_id', addressId)
    } else {
        query = query.is('owner_address_id', null)
    }

    const { data: prods, error } = await query

    if (error) {
        console.error('fetchProducts error:', error)
        return []
    }

    let products = prods || []

    products.sort((a, b) => {
        const aSort = a.sort_order ?? 999999;
        const bSort = b.sort_order ?? 999999;
        if (aSort !== bSort) return aSort - bSort;
        return a.name.localeCompare(b.name);
    })

    return products
}

// Update product price directly (isolated clone architecture)
export async function upsertProductPrice(productId, addressId, price) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductPrice(productId, price)
    if (!supabase) return
    const { error } = await supabase
        .from('products')
        .update({ price })
        .eq('id', productId)
    if (error) throw error
}

// Toggle whether a product counts toward daily cup total
export async function updateProductCountAsCup(productId, countAsCup) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductCountAsCup(productId, countAsCup)
    if (!supabase) return
    const { error } = await supabase
        .from('products')
        .update({ count_as_cup: countAsCup })
        .eq('id', productId)
    if (error) throw error
}

// Fetch today's revenue + cups (cups excludes products with count_as_cup=false).
// Uses the get_today_stats RPC which aggregates in Postgres — payload is a
// single row instead of every order joined to its items + products. Falls
// back to the legacy client-side aggregation if the RPC isn't deployed yet
// (so this code is safe to ship before the migration runs).
export async function fetchTodayStats(addressId) {
    if (localRepo.isGuest()) {
        const orders = localRepo.fetchLocalOrders(addressId)
        let revenue = 0, cups = 0
        orders.forEach(o => {
            if (!o.deleted_at) revenue += Number(o.total || 0)
            const items = o.order_items || o.items || []
            items.forEach(i => {
                // In local mode, we don't have the products table join easily, 
                // so we assume everything is a cup unless specified in seeding.
                // For demo, this is fine.
                cups += Number(i.quantity || 0)
            })
        })
        return { revenue, cups }
    }
    if (!supabase || !addressId) return { revenue: 0, cups: 0 }

    const { data, error } = await supabase.rpc('get_today_stats', { p_address_id: addressId })
    if (!error && data) {
        const row = Array.isArray(data) ? data[0] : data
        return {
            revenue: Number(row?.revenue || 0),
            cups: Number(row?.cups || 0)
        }
    }

    // Fallback: function not deployed (PGRST202 / 42883). Use legacy query.
    if (error && error.code !== 'PGRST202' && error.code !== '42883') {
        console.error('fetchTodayStats RPC error:', error)
    }

    const from = new Date()
    from.setHours(0, 0, 0, 0)
    const { data: legacyData, error: legacyError } = await supabase
        .from('orders')
        .select('total, order_items(quantity, products(count_as_cup))')
        .eq('address_id', addressId)
        .gte('created_at', from.toISOString())

    if (legacyError) { console.error('fetchTodayStats legacy error:', legacyError); return { revenue: 0, cups: 0 } }

    let revenue = 0, cups = 0
    ;(legacyData || []).forEach(o => {
        revenue += Number(o.total || 0)
        ;(o.order_items || []).forEach(i => {
            if (i.products?.count_as_cup !== false) cups += Number(i.quantity || 0)
        })
    })
    return { revenue, cups }
}

// Fetch all orders for today, newest first (optionally scoped by address)
export async function fetchTodayOrders(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalOrders(addressId)
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('orders')
        .select(`
            id,
            total,
            total_cost,
            payment_method,
            created_at,
            deleted_at,
            deleted_by,
            order_items (
                quantity,
                options,
                product_id,
                unit_cost,
                extra_ids,
                products (
                    name
                )
            ),
            staff_name
        `)
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
        console.error('fetchTodayOrders error:', error)
        return []
    }
    return data
}

// Fetch today's expenses, newest first (optionally scoped by address)
export async function fetchTodayExpenses(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalExpenses(addressId)
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

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

// Delete an expense
export async function deleteExpense(expenseId) {
    if (localRepo.isGuest()) return localRepo.deleteLocalExpense(expenseId)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expenseId)
    if (error) throw error
    return true
}

// ---- Fixed Costs CRUD ----

// Fetch all active fixed costs for an address
export async function fetchFixedCosts(addressId) {
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
}

// Insert a new fixed cost
export async function insertFixedCost(name, amount, addressId) {
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

// Update a fixed cost (name and/or amount)
export async function updateFixedCost(id, updates) {
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

// Soft-delete a fixed cost
export async function deleteFixedCost(id) {
    if (localRepo.isGuest()) return localRepo.deleteLocalFixedCost(id)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('fixed_costs')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
    if (error) throw error
    return true
}

// Fetch current inventory (Disabled for now)
export async function fetchInventory() {
    return {}
}

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
    let query = supabase.from('ingredient_costs').select('ingredient, unit_cost, unit, address_id, pack_size, pack_unit, min_stock')

    if (addressId) {
        query = query.or(`address_id.eq.${addressId},address_id.is.null`)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchIngredientCostsAndUnits error:', error)
        return { costs: {}, units: {}, rows: [] }
    }
    if (!data || data.length === 0) return { costs: {}, units: {}, rows: [] }

    const defaultData = data.filter(d => d.address_id === null)
    const addressData = data.filter(d => d.address_id === addressId)

    const costs = {}
    const units = {}
    const ingredientMap = {}

    for (const d of defaultData) {
        costs[d.ingredient] = d.unit_cost
        units[d.ingredient] = d.unit || 'đv'
        ingredientMap[d.ingredient] = { ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost, pack_size: d.pack_size, pack_unit: d.pack_unit, min_stock: d.min_stock }
    }
    for (const d of addressData) {
        costs[d.ingredient] = d.unit_cost
        units[d.ingredient] = d.unit || 'đv'
        ingredientMap[d.ingredient] = { ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost, pack_size: d.pack_size, pack_unit: d.pack_unit, min_stock: d.min_stock }
    }

    return { costs, units, rows: Object.values(ingredientMap) }
}

// Kept for backward-compat with callers that only need the costs map
export async function fetchIngredientCosts(addressId) {
    const { costs } = await fetchIngredientCostsAndUnits(addressId)
    return costs
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

// Create a new product and link to the current address
export async function insertProduct(name, price, addressId = null) {
    if (localRepo.isGuest()) return localRepo.insertLocalProduct({ name, price, owner_address_id: addressId })
    if (!supabase) throw new Error('No Supabase connection')

    const payload = { name, price }
    if (addressId) payload.owner_address_id = addressId

    let query = supabase.from('products').select('sort_order')
    if (addressId) query = query.eq('owner_address_id', addressId)
    else query = query.is('owner_address_id', null)

    const { data: maxRow } = await query.order('sort_order', { ascending: false }).limit(1).maybeSingle()
    payload.sort_order = (maxRow?.sort_order ?? -1) + 1

    const { data, error } = await supabase
        .from('products')
        .insert(payload)
        .select()
        .single()

    if (error) throw error
    return data
}

// Remove a product from an address (soft delete).
// addressId kept for call-site clarity / future RLS scoping; today it's not
// used because each address owns its own product rows.
export async function removeProductFromAddress(productId, _addressId) {
    if (localRepo.isGuest()) {
        const products = localRepo.getGuestDataForSync().products;
        const idx = products.findIndex(p => p.id === productId);
        if (idx >= 0) {
            products[idx].is_active = false;
            localStorage.setItem('guest_products', JSON.stringify(products));
        }
        return true;
    }
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', productId)
    if (error) throw error
    return true
}

// Update sort order for products at an address.
// Single RPC writes all rows in one statement — N parallel UPDATEs would each pay
// PostgREST overhead (auth + RLS + lock). Falls back to legacy parallel updates
// if the RPC isn't deployed yet.
export async function updateProductSortOrder(addressId, orderedProductIds) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductSortOrder(orderedProductIds)
    if (!supabase) throw new Error('No Supabase connection')
    if (!orderedProductIds?.length) return

    const { error } = await supabase.rpc('update_products_sort_order', { p_ids: orderedProductIds })
    if (!error) return
    // Fall back on:
    //   PGRST202/42883: function not deployed
    //   42703: bad column reference (legacy RPC pre-fix migration 20260517_default_sort_and_rpc_fix.sql)
    // Anything else (RLS, auth) → rethrow.
    if (!['PGRST202', '42883', '42703'].includes(error.code)) throw error

    // Fallback: parallel per-row updates
    const updates = orderedProductIds.map((productId, index) =>
        supabase.from('products').update({ sort_order: index }).eq('id', productId)
    )
    await Promise.all(updates)
}

// ---- Product Extras CRUD ----

// Fetch all product extras (Pure isolated)
export async function fetchProductExtras(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalProductExtras(addressId)
    if (!supabase) return {}
    let query = supabase.from('product_extras').select('id, product_id, name, price, address_id, sort_order, is_sticky').order('sort_order', { ascending: true, nullsFirst: false })

    if (addressId) {
        query = query.eq('address_id', addressId)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchProductExtras error:', error)
        return {}
    }
    if (!data || data.length === 0) return {}

    const extrasMap = {}
    for (const ex of data) {
        if (!ex.id) continue  // skip corrupted rows with null id
        if (!extrasMap[ex.product_id]) extrasMap[ex.product_id] = []
        extrasMap[ex.product_id].push({ id: ex.id, name: ex.name, price: ex.price, is_sticky: ex.is_sticky || false })
    }
    return extrasMap
}

// Add a new product extra
export async function insertProductExtra(productId, name, price, addressId = null) {
    if (localRepo.isGuest()) return localRepo.insertLocalProductExtra({ product_id: productId, name, price, address_id: addressId })
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { product_id: productId, name, price }
    if (addressId) payload.address_id = addressId

    // Assign sort_order = max + 1 so the new extra lands at the bottom
    let maxQuery = supabase.from('product_extras').select('sort_order').eq('product_id', productId)
    if (addressId) maxQuery = maxQuery.eq('address_id', addressId)
    else maxQuery = maxQuery.is('address_id', null)
    const { data: maxRow } = await maxQuery
        .order('sort_order', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
    payload.sort_order = (maxRow?.sort_order ?? -1) + 1

    const { data, error } = await supabase
        .from('product_extras')
        .insert(payload)
        .select()
        .single()
    if (error) throw error
    return data
}

// Update a product extra's name
export async function updateProductExtraName(extraId, name) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductExtraName(extraId, name)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .update({ name })
        .eq('id', extraId)
    if (error) throw error
}

// Update a product extra's price
export async function updateProductExtraPrice(extraId, price) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductExtraPrice(extraId, price)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .update({ price })
        .eq('id', extraId)
    if (error) throw error
}

// Duplicate a product extra (copy extra + all its extra_ingredients) with a new name
export async function duplicateProductExtra(extraId, newName, addressId = null) {
    if (localRepo.isGuest()) return localRepo.duplicateLocalProductExtra(extraId, newName, addressId)
    if (!supabase) throw new Error('No Supabase connection')

    const { data: src, error: e1 } = await supabase
        .from('product_extras').select('product_id, price').eq('id', extraId).single()
    if (e1) throw e1

    const payload = { product_id: src.product_id, name: newName, price: src.price }
    if (addressId) payload.address_id = addressId

    // Assign sort_order = max + 1 so the duplicate lands at the bottom
    let maxQuery = supabase.from('product_extras').select('sort_order').eq('product_id', src.product_id)
    if (addressId) maxQuery = maxQuery.eq('address_id', addressId)
    else maxQuery = maxQuery.is('address_id', null)
    const { data: maxRow } = await maxQuery
        .order('sort_order', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
    payload.sort_order = (maxRow?.sort_order ?? -1) + 1

    const { data: newExtra, error: e2 } = await supabase
        .from('product_extras').insert(payload).select().single()
    if (e2) throw e2

    const { data: ings } = await supabase
        .from('extra_ingredients').select('ingredient, amount, unit').eq('extra_id', extraId)
    if (ings?.length) {
        await supabase.from('extra_ingredients').insert(
            ings.map(i => ({ extra_id: newExtra.id, ingredient: i.ingredient, amount: i.amount, unit: i.unit }))
        )
    }
    return newExtra
}

// Update sort_order for a list of extras — see updateProductSortOrder for the
// reasoning behind the single-RPC pattern.
export async function updateExtrasSortOrder(orderedExtraIds) {
    if (localRepo.isGuest()) return localRepo.updateLocalExtrasSortOrder(orderedExtraIds)
    if (!supabase) throw new Error('No Supabase connection')
    if (!orderedExtraIds?.length) return

    const { error } = await supabase.rpc('update_extras_sort_order', { p_ids: orderedExtraIds })
    if (!error) return
    if (error.code !== 'PGRST202' && error.code !== '42883') throw error

    // Fallback: parallel per-row updates (pre-migration codepath)
    const results = await Promise.all(
        orderedExtraIds.map((id, index) =>
            supabase.from('product_extras').update({ sort_order: index }).eq('id', id)
        )
    )
    const failed = results.find(r => r.error)
    if (failed) throw new Error(failed.error.message)
}

// Delete a product extra
export async function updateProductExtraSticky(extraId, isSticky) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductExtraSticky(extraId, isSticky)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .update({ is_sticky: isSticky })
        .eq('id', extraId)
    if (error) throw error
}

export async function deleteProductExtra(extraId) {
    if (localRepo.isGuest()) return localRepo.deleteLocalProductExtra(extraId)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .delete()
        .eq('id', extraId)
    if (error) throw error
    return true
}

// ---- Extra Ingredients CRUD ----

// Fetch extra ingredients scoped to a set of extra IDs (pass [] to skip, null to fetch all)
export async function fetchExtraIngredients(extraIds = null) {
    if (localRepo.isGuest()) return localRepo.fetchLocalExtraIngredients(extraIds)
    if (!supabase) return {}
    if (Array.isArray(extraIds) && extraIds.length === 0) return {}

    let query = supabase.from('extra_ingredients').select('id, extra_id, ingredient, amount, unit')
    if (extraIds?.length) query = query.in('extra_id', extraIds)

    const { data, error } = await query
    if (error) {
        console.error('fetchExtraIngredients error:', error)
        return {}
    }
    const extrasMap = {}
    for (const row of data || []) {
        if (!extrasMap[row.extra_id]) extrasMap[row.extra_id] = []
        extrasMap[row.extra_id].push(row)
    }
    return extrasMap
}

// Upsert extra ingredient
export async function upsertExtraIngredient(extraId, ingredient, amount, unit = null) {
    if (localRepo.isGuest()) return localRepo.upsertLocalExtraIngredient({ extra_id: extraId, ingredient, amount, unit })
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { extra_id: extraId, ingredient, amount }
    if (unit) payload.unit = unit
    const { error } = await supabase
        .from('extra_ingredients')
        .upsert(payload, { onConflict: 'extra_id,ingredient' })
    if (error) throw error
}

// Delete extra ingredient
export async function deleteExtraIngredient(extraId, ingredient) {
    if (localRepo.isGuest()) return localRepo.deleteLocalExtraIngredient(extraId, ingredient)
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('extra_ingredients')
        .delete()
        .eq('extra_id', extraId)
        .eq('ingredient', ingredient)
    if (error) throw error
    return true
}

// Submit a complete order to Supabase using RPC for atomic transaction
// totalCost: tổng giá vốn của bill (snapshot)
// costPerItem: Map<cartItemId, unitCost> giá vốn mỗi dòng (snapshot)
export async function submitOrder(cart, total, paymentMethod = null, addressId = null, totalCost = 0, costPerItem = {}, staffName = null) {
    if (localRepo.isGuest()) {
        return localRepo.submitLocalOrder({
            total,
            total_cost: Math.round(totalCost),
            payment_method: paymentMethod,
            address_id: addressId,
            staff_name: staffName,
            order_items: cart.map(item => ({
                product_id: item.productId,
                quantity: item.quantity,
                options: item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null,
                unit_cost: Math.round(costPerItem[item.cartItemId] || 0)
            }))
        })
    }
    if (!supabase) throw new Error('No Supabase connection')

    const orderPayload = {
        total,
        total_cost: Math.round(totalCost),
        payment_method: paymentMethod,
        address_id: addressId,
        staff_name: staffName,
        items: cart.map(item => {
            const optionsText = item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null;
            const extraIds = item.extras?.length > 0 ? item.extras.map(e => e.id).filter(Boolean) : [];
            return {
                product_id: item.productId,
                quantity: item.quantity,
                options: optionsText,
                unit_cost: Math.round(costPerItem[item.cartItemId] || 0),
                extra_ids: extraIds
            }
        })
    }

    // Call RPC function for single transaction order creation
    const { error } = await supabase.rpc('bulk_create_orders', {
        orders_payload: [orderPayload]
    })

    if (error) throw error
    return { id: null }
}

// Bulk submit offline orders in ONE HTTP Request
export async function bulkSubmitOrders(ordersArray) {
    if (localRepo.isGuest()) {
        ordersArray.forEach(o => localRepo.submitLocalOrder(o))
        return true
    }
    if (!supabase) throw new Error('No Supabase connection')

    const payload = ordersArray.map(o => ({
        total: o.total,
        total_cost: o.totalCost || 0,
        payment_method: o.paymentMethod,
        address_id: o.addressId,
        created_at: o.createdAt,
        staff_name: o.staffName,
        items: o.orderItems.map(item => {
            const optionsText = item.extras?.length > 0 ? item.extras.map(e => e.name).join(', ') : null;
            const extraIds = item.extras?.length > 0 ? item.extras.map(e => e.id).filter(Boolean) : (item.extraIds || []).filter(Boolean);
            return {
                product_id: item.productId,
                quantity: item.quantity,
                options: optionsText,
                unit_cost: Math.round(item.unitCost || 0),
                extra_ids: extraIds
            }
        })
    }))

    const { error } = await supabase.rpc('bulk_create_orders', {
        orders_payload: payload
    })

    if (error) throw error
    return true
}

// Soft Delete an order
export async function deleteOrder(orderId, staffName = null) {
    if (localRepo.isGuest()) return localRepo.deleteLocalOrder(orderId, staffName)
    if (!supabase) throw new Error('No Supabase connection')

    const { error: orderError } = await supabase
        .from('orders')
        .update({ deleted_at: new Date().toISOString(), deleted_by: staffName })
        .eq('id', orderId)

    if (orderError) throw orderError

    return true
}

// ---- Shift Closing CRUD ----

// Insert a shift closing record
export async function insertShiftClosing(data) {
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    const { data: row, error } = await supabase
        .from('shift_closings')
        .insert(data)
        .select()
        .single()
    if (error) throw error
    return row
}

// Update an existing shift closing record
export async function updateShiftClosing(id, data) {
    if (localRepo.isGuest()) return localRepo.upsertLocalShiftClosing(data)
    if (!supabase) throw new Error('No Supabase connection')
    const { data: row, error } = await supabase
        .from('shift_closings')
        .update(data)
        .eq('id', id)
        .select()
        .single()
    if (error) throw error
    return row
}

// Fetch all orders for yesterday (start of yesterday to start of today), scoped by address
export async function fetchYesterdayOrders(addressId) {
    if (localRepo.isGuest()) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return localRepo.fetchLocalOrders(addressId, yesterday.toISOString())
    }
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let query = supabase
        .from('orders')
        .select(`
            id,
            total,
            total_cost,
            staff_name,
            deleted_at,
            order_items (
                quantity,
                product_id,
                unit_cost,
                extra_ids
            )
        `)
        .gte('created_at', yesterday.toISOString())
        .lt('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query
    if (error) {
        console.error('fetchYesterdayOrders error:', error)
        return []
    }
    return data || []
}

// Fetch yesterday's expenses, scoped by address
export async function fetchYesterdayExpenses(addressId) {
    if (localRepo.isGuest()) {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        return localRepo.fetchLocalExpenses(addressId, yesterday.toISOString())
    }
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
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

// Fetch orders within a date range for an address (same structure as fetchTodayOrders)
export async function fetchOrdersByRange(addressId, start, end) {
    if (localRepo.isGuest()) {
        const sMs = start.getTime(), eMs = end.getTime()
        return localRepo.fetchAllLocalOrders(addressId)
            .filter(o => {
                const t = new Date(o.created_at).getTime()
                return t >= sMs && t <= eMs
            })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }
    if (!supabase) return []
    let query = supabase
        .from('orders')
        .select(`id, total, total_cost, payment_method, staff_name, created_at, deleted_at, deleted_by,
            order_items(quantity, options, product_id, unit_cost, extra_ids, products(name))`)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
    if (addressId) query = query.eq('address_id', addressId)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) { console.error('fetchOrdersByRange error:', error); return [] }
    return data || []
}

// Fetch expenses within a date range
export async function fetchExpensesByRange(addressId, start, end) {
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

// Fetch the most recent order today for an address (with items + product names)
export async function fetchLatestOrder(addressId) {
    if (localRepo.isGuest()) {
        const todayStr = new Date().toDateString()
        const today = localRepo.fetchAllLocalOrders(addressId)
            .filter(o => new Date(o.created_at).toDateString() === todayStr)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        return today[0] || null
    }
    if (!supabase) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('orders')
        .select(`id, total, created_at, deleted_at, deleted_by, order_items(quantity, options, product_id, products(name))`)
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error || !data) return null
    return data
}

// Fetch today's shift closing for an address (latest one)
export async function fetchTodayShiftClosing(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalShiftClosing(addressId, new Date().toISOString())
    if (!supabase) return null
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

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

// Fetch the most recent shift closing BEFORE today (for opening stock)
export async function fetchYesterdayShiftClosing(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalYesterdayShiftClosing(addressId)
    if (!supabase) return null
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

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

// Kept for backward-compat — delegates to fetchIngredientCostsAndUnits
export async function fetchIngredientCostsWithUnits(addressId) {
    const { rows } = await fetchIngredientCostsAndUnits(addressId)
    return rows
}

// Fetch order items for the past `days` fully completed days (excluding today)
export async function fetchPastDaysOrderItems(addressId, days = 7) {
    if (!supabase) return []
    const endDate = new Date()
    endDate.setHours(0, 0, 0, 0)

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
}

// Fetch order items for exactly "same day last week" (for tomorrow's prediction, so 6 days ago)
export async function fetchLastWeekSameDayOrderItems(addressId) {
    if (!supabase) return []
    // If today is Tuesday, tomorrow is Wednesday. We want to predict tomorrow using Today and Last Wednesday.
    // Last Wednesday is Today - 6 days.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
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

    // Fallback step 1: latest closing + all refills (parallel, both small)
    const [latestRes, refillsRes] = await Promise.all([
        applyAddrFilter(
            supabase
                .from('shift_closings')
                .select('inventory_report')
        )
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        applyAddrFilter(
            supabase
                .from('expenses')
                .select('created_at, metadata')
        ).eq('is_refill', true)
    ])

    const counter = {}
    const todayRestock = {}
    const latestReport = Array.isArray(latestRes.data?.inventory_report) ? latestRes.data.inventory_report : []
    latestReport.forEach(item => {
        counter[item.ingredient] = Number(item.remaining) || 0
        todayRestock[item.ingredient] = Number(item.restock) || 0
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
    invalidateDailyContext(addressId)
    return result
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

// ---- Reports (Daily / Range) ----
// In-memory TTL cache: spares the RPC when the manager toggles between Báo cáo / Nhật ký
// tabs (shared footer). 30 s is short enough that user-driven changes appear soon, long
// enough that quick tab toggles feel instant. Invalidated explicitly when relevant state
// mutates (shift_closing insert/update, expense add/delete) via invalidateDailyContext().
const _dailyContextCache = new Map() // addressId → { data, t }
const DAILY_CONTEXT_TTL_MS = 30_000

export function invalidateDailyContext(addressId) {
    if (addressId) _dailyContextCache.delete(addressId)
    else _dailyContextCache.clear()
}

export async function fetchDailyReportContext(addressId) {
    if (!addressId) return {}
    const cached = _dailyContextCache.get(addressId)
    if (cached && Date.now() - cached.t < DAILY_CONTEXT_TTL_MS) {
        return cached.data
    }

    let data
    if (localRepo.isGuest()) {
        const todayStr = new Date().toDateString()
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toDateString()

        data = {
            shift_closing: localRepo.fetchLocalShiftClosing(addressId, todayStr) || null,
            yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || localRepo.fetchLocalYesterdayShiftClosing(addressId) || null,
            yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
            yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr)
        }
    } else if (!supabase) {
        data = {}
    } else {
        const { data: rpcData, error } = await supabase.rpc('get_daily_report_context', { p_address_id: addressId })
        if (error) throw error
        data = rpcData || {}
    }
    _dailyContextCache.set(addressId, { data, t: Date.now() })
    return data
}

export async function fetchReportByDate(addressId, dateStr) {
    if (localRepo.isGuest()) {
        const targetDateStr = new Date(dateStr).toDateString()
        const targetDate = new Date(targetDateStr)
        
        const yesterday = new Date(targetDate)
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toDateString()

        return {
            shift_closing: localRepo.fetchLocalShiftClosing(addressId, targetDateStr) || null,
            yesterday_closing: localRepo.fetchLocalShiftClosing(addressId, yesterdayStr) || null,
            yesterday_orders: localRepo.fetchLocalOrders(addressId, yesterdayStr),
            yesterday_expenses: localRepo.fetchLocalExpenses(addressId, yesterdayStr),
            target_orders: localRepo.fetchLocalOrders(addressId, targetDateStr),
            target_expenses: localRepo.fetchLocalExpenses(addressId, targetDateStr)
        }
    }
    if (!supabase) return {}
    const { data, error } = await supabase.rpc('get_report_by_date', { p_address_id: addressId, p_date: dateStr })
    if (error) throw error
    return data || {}
}

export async function fetchReportByRange(addressId, targetStart, targetEnd, prevStart, prevEnd) {
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

        return {
            target_orders: filterRange(allOrders, tS, tE),
            target_expenses: filterRange(allExpenses, tS, tE),
            target_shift_closings: filterRange(allClosings, tS, tE),
            prev_orders: filterRange(allOrders, pS, pE),
            prev_expenses: filterRange(allExpenses, pS, pE),
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
}
