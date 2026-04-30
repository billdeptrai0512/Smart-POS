import { supabase } from '../lib/supabaseClient'



// Fetch all products for the menu (purely branch isolated)
export async function fetchProducts(addressId) {
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
    if (!supabase) return
    const { error } = await supabase
        .from('products')
        .update({ price })
        .eq('id', productId)
    if (error) throw error
}

// Toggle whether a product counts toward daily cup total
export async function updateProductCountAsCup(productId, countAsCup) {
    if (!supabase) return
    const { error } = await supabase
        .from('products')
        .update({ count_as_cup: countAsCup })
        .eq('id', productId)
    if (error) throw error
}

// Fetch today's revenue + cups (cups excludes products with count_as_cup=false)
export async function fetchTodayStats(addressId) {
    if (!supabase || !addressId) return { revenue: 0, cups: 0 }
    const from = new Date()
    from.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
        .from('orders')
        .select('total, order_items(quantity, products(count_as_cup))')
        .eq('address_id', addressId)
        .gte('created_at', from.toISOString())

    if (error) { console.error('fetchTodayStats error:', error); return { revenue: 0, cups: 0 } }

    let revenue = 0, cups = 0
        ; (data || []).forEach(o => {
            revenue += Number(o.total || 0)
                ; (o.order_items || []).forEach(i => {
                    if (i.products?.count_as_cup !== false) cups += Number(i.quantity || 0)
                })
        })
    return { revenue, cups }
}

// Fetch all orders for today, newest first (optionally scoped by address)
export async function fetchTodayOrders(addressId) {
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
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('expenses')
        .select('id, name, amount, staff_name, is_fixed, created_at')
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

// Insert an expense (supports is_fixed flag for auto-injected fixed costs)
export async function insertExpense(name, amount, addressId = null, isFixed = false, staffName = null) {
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { name, amount, is_fixed: isFixed }
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
    if (!supabase) return { costs: {}, units: {}, rows: [] }
    let query = supabase.from('ingredient_costs').select('ingredient, unit_cost, unit, address_id')

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
        ingredientMap[d.ingredient] = { ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost }
    }
    for (const d of addressData) {
        costs[d.ingredient] = d.unit_cost
        units[d.ingredient] = d.unit || 'đv'
        ingredientMap[d.ingredient] = { ingredient: d.ingredient, unit: d.unit || 'đv', unit_cost: d.unit_cost }
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
export async function upsertIngredientCost(ingredient, unitCost, addressId = null, unit = null) {
    if (!supabase) throw new Error('No Supabase connection')

    const payload = { ingredient, unit_cost: unitCost }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    const { error } = await supabase
        .from('ingredient_costs')
        .upsert(payload, { onConflict: 'ingredient,address_id' })
    if (error) throw error
}

// Rename an ingredient key across all tables
export async function renameIngredient(oldKey, newKey) {
    if (!supabase) throw new Error('No Supabase connection')
    if (oldKey === newKey) return
    await supabase.from('ingredient_costs').update({ ingredient: newKey }).eq('ingredient', oldKey)
    await supabase.from('recipes').update({ ingredient: newKey }).eq('ingredient', oldKey)
    await supabase.from('extra_ingredients').update({ ingredient: newKey }).eq('ingredient', oldKey)
}

// Delete an ingredient cost entry (removes all rows for this ingredient)
export async function deleteIngredientCost(ingredient, addressId = null) {
    if (!supabase) throw new Error('No Supabase connection')
    // Delete address-specific row if exists
    if (addressId) {
        await supabase.from('ingredient_costs').delete()
            .eq('ingredient', ingredient)
            .eq('address_id', addressId)
    }
    // Also delete the default (null) row
    await supabase.from('ingredient_costs').delete()
        .eq('ingredient', ingredient)
        .is('address_id', null)
    return true
}

// Create a new product and link to the current address
export async function insertProduct(name, price, addressId = null) {
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
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', productId)
    if (error) throw error
    return true
}

// Update sort order for products at an address
export async function updateProductSortOrder(addressId, orderedProductIds) {
    if (!supabase) throw new Error('No Supabase connection')
    // Directly update native sort_order in products table
    const updates = orderedProductIds.map((productId, index) =>
        supabase
            .from('products')
            .update({ sort_order: index })
            .eq('id', productId)
    )
    await Promise.all(updates)
}

// ---- Product Extras CRUD ----

// Fetch all product extras (Pure isolated)
export async function fetchProductExtras(addressId) {
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
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .update({ name })
        .eq('id', extraId)
    if (error) throw error
}

// Update a product extra's price
export async function updateProductExtraPrice(extraId, price) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .update({ price })
        .eq('id', extraId)
    if (error) throw error
}

// Duplicate a product extra (copy extra + all its extra_ingredients) with a new name
export async function duplicateProductExtra(extraId, newName, addressId = null) {
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

// Update sort_order for a list of extras
export async function updateExtrasSortOrder(orderedExtraIds) {
    if (!supabase) throw new Error('No Supabase connection')
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
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('product_extras')
        .update({ is_sticky: isSticky })
        .eq('id', extraId)
    if (error) throw error
}

export async function deleteProductExtra(extraId) {
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

// Delete an order and its items (for duplicate order cleanup)
export async function deleteOrder(orderId) {
    if (!supabase) throw new Error('No Supabase connection')

    // Delete order_items first (FK constraint)
    const { error: itemsError } = await supabase
        .from('order_items')
        .delete()
        .eq('order_id', orderId)

    if (itemsError) throw itemsError

    const { error: orderError } = await supabase
        .from('orders')
        .delete()
        .eq('id', orderId)

    if (orderError) throw orderError

    return true
}

// ---- Shift Closing CRUD ----

// Insert a shift closing record
export async function insertShiftClosing(data) {
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
    if (!supabase) return []
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    let query = supabase
        .from('expenses')
        .select('id, name, amount, staff_name, is_fixed, created_at, address_id')
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
    if (!supabase) return []
    let query = supabase
        .from('orders')
        .select(`id, total, total_cost, payment_method, staff_name, created_at,
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
    if (!supabase) return []
    let query = supabase
        .from('expenses')
        .select('id, name, amount, staff_name, is_fixed, created_at, address_id')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
    if (addressId) query = query.eq('address_id', addressId)
    const { data, error } = await query.order('created_at', { ascending: false })
    if (error) { console.error('fetchExpensesByRange error:', error); return [] }
    return data || []
}

// Fetch shift closings within a date range (for summing cash/transfer)
export async function fetchShiftClosingsByRange(addressId, start, end) {
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
    if (!supabase) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let query = supabase
        .from('orders')
        .select(`id, total, created_at, order_items(quantity, options, product_id, products(name))`)
        .gte('created_at', today.toISOString())

    if (addressId) query = query.eq('address_id', addressId)

    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (error || !data) return null
    return data
}

// Fetch today's shift closing for an address (latest one)
export async function fetchTodayShiftClosing(addressId) {
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
