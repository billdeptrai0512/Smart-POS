import { supabase } from '../lib/supabaseClient'



// Fetch all products for the menu (scoped to address via address_products)
export async function fetchProducts(addressId) {
    if (!supabase) return []

    // If addressId provided, fetch via address_products join for per-address menu
    if (addressId) {
        const { data: addressProds, error: apError } = await supabase
            .from('address_products')
            .select('product_id, sort_order, products(*)')
            .eq('address_id', addressId)
            .order('sort_order')

        if (!apError && addressProds && addressProds.length > 0) {
            // Merge with address-specific prices
            const { data: prices } = await supabase
                .from('product_prices')
                .select('product_id, price')
                .eq('address_id', addressId)

            const priceMap = {}
            if (prices) for (let p of prices) priceMap[p.product_id] = p.price

            return addressProds
                .filter(ap => ap.products && ap.products.is_active !== false)
                .map(ap => ({
                    ...ap.products,
                    price: priceMap[ap.product_id] !== undefined ? priceMap[ap.product_id] : ap.products.price
                }))
        }

        // Fallback: address_products table might not exist yet or no rows
        // Fall through to global fetch
    }

    // Global fallback (no address or address_products not set up yet)
    let { data: prods, error } = await supabase
        .from('products')
        .select('id, name, price, is_active')
        .eq('is_active', true)
        .order('name')

    if (error) {
        if (error.code === '42703') {
            const { data: fallbackProds } = await supabase.from('products').select('id, name, price, is_active').order('name')
            prods = fallbackProds
        } else {
            console.error('fetchProducts error:', error)
            return []
        }
    }

    const products = prods || []

    if (addressId && products.length > 0) {
        const { data: prices } = await supabase
            .from('product_prices')
            .select('product_id, price')
            .eq('address_id', addressId)

        if (prices && prices.length > 0) {
            const priceMap = {}
            for (let p of prices) priceMap[p.product_id] = p.price
            return products.map(prod => ({
                ...prod,
                price: priceMap[prod.id] !== undefined ? priceMap[prod.id] : prod.price
            }))
        }
    }

    return products
}

// Upsert a product price override for a specific address
export async function upsertProductPrice(productId, addressId, price) {
    if (!supabase) return
    const { error } = await supabase
        .from('product_prices')
        .upsert({ product_id: productId, address_id: addressId, price }, { onConflict: 'product_id,address_id' })
    if (error) throw error
}

// Fetch today's revenue + cups in a single DB aggregate (replaces fetchTodayRevenue + fetchTodayCupsSold)
export async function fetchTodayStats(addressId) {
    if (!supabase || !addressId) return { revenue: 0, cups: 0 }
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    const { data, error } = await supabase.rpc('get_today_stats', {
        p_address_id: addressId,
        p_from: from.toISOString(),
        p_to: new Date().toISOString(),
    })
    if (error) { console.error('fetchTodayStats error:', error); return { revenue: 0, cups: 0 } }
    return { revenue: Number(data?.revenue || 0), cups: Number(data?.cups || 0) }
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
            )
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
        .select('id, name, amount, is_fixed, created_at')
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
export async function insertExpense(name, amount, addressId = null, isFixed = false) {
    if (!supabase) throw new Error('No Supabase connection')
    const payload = { name, amount, is_fixed: isFixed }
    if (addressId) payload.address_id = addressId

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

// Fetch all recipes from Supabase
export async function fetchAllRecipes(addressId) {
    if (!supabase) return []
    let query = supabase.from('recipes').select('product_id, ingredient, amount, unit, address_id')

    if (addressId) {
        query = query.or(`address_id.eq.${addressId},address_id.is.null`)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchAllRecipes error:', error)
        return []
    }

    if (!data || data.length === 0) return []

    const defaultData = data.filter(d => d.address_id === null)
    const addressData = data.filter(d => d.address_id === addressId)
    const addressProductIds = new Set(addressData.map(d => d.product_id))

    const finalRecipes = [...addressData]
    for (const d of defaultData) {
        if (!addressProductIds.has(d.product_id)) {
            finalRecipes.push(d)
        }
    }

    return finalRecipes
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

// Utility to ensure an address has a copy of the default recipe for a product before modifying
async function ensureAddressRecipe(productId, addressId) {
    if (!supabase || !addressId) return

    const { data } = await supabase
        .from('recipes')
        .select('id')
        .eq('product_id', productId)
        .eq('address_id', addressId)
        .limit(1)

    if (!data || data.length === 0) {
        // clone default recipe for this product
        const { data: defaults } = await supabase
            .from('recipes')
            .select('product_id, ingredient, amount, unit')
            .eq('product_id', productId)
            .is('address_id', null)

        if (defaults && defaults.length > 0) {
            const inserts = defaults.map(d => ({ ...d, address_id: addressId }))
            await supabase.from('recipes').insert(inserts)
        }
    }
}

// Upsert a recipe row (insert or update ingredient amount for a product)
export async function upsertRecipe(productId, ingredient, amount, addressId = null, unit = null) {
    if (!supabase) throw new Error('No Supabase connection')

    if (addressId) {
        await ensureAddressRecipe(productId, addressId)
    }

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
    if (addressId) {
        await ensureAddressRecipe(productId, addressId)
    }

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
    const { data, error } = await supabase
        .from('products')
        .insert({ name, price })
        .select()
        .single()
    if (error) throw error

    // Link to address_products with sort_order at the end
    if (data && addressId) {
        // Get current max sort_order for this address
        const { data: maxRow } = await supabase
            .from('address_products')
            .select('sort_order')
            .eq('address_id', addressId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .maybeSingle()

        const nextOrder = (maxRow?.sort_order ?? -1) + 1

        await supabase.from('address_products').insert({
            address_id: addressId,
            product_id: data.id,
            sort_order: nextOrder
        })
    }

    return data
}

// Remove a product from an address (unlink from address_products)
export async function removeProductFromAddress(productId, addressId) {
    if (!supabase) throw new Error('No Supabase connection')
    const { error } = await supabase
        .from('address_products')
        .delete()
        .eq('product_id', productId)
        .eq('address_id', addressId)
    if (error) throw error
    return true
}

// Update sort order for products at an address
export async function updateProductSortOrder(addressId, orderedProductIds) {
    if (!supabase) throw new Error('No Supabase connection')

    // Batch update sort_order for each product
    const updates = orderedProductIds.map((productId, index) =>
        supabase
            .from('address_products')
            .update({ sort_order: index })
            .eq('address_id', addressId)
            .eq('product_id', productId)
    )

    await Promise.all(updates)
}

// ---- Product Extras CRUD ----

// Fetch all product extras (returns { productId: [{ id, name, price }] })
export async function fetchProductExtras(addressId) {
    if (!supabase) return {}
    let query = supabase.from('product_extras').select('id, product_id, name, price, address_id, sort_order, is_sticky').order('sort_order', { ascending: true, nullsFirst: false })

    if (addressId) {
        query = query.or(`address_id.eq.${addressId},address_id.is.null`)
    } else {
        query = query.is('address_id', null)
    }

    const { data, error } = await query
    if (error) {
        console.error('fetchProductExtras error:', error)
        return {}
    }
    if (!data || data.length === 0) return {}

    // Address-specific extras override defaults per product
    const defaultExtras = data.filter(d => d.address_id === null)
    const addressExtras = data.filter(d => d.address_id === addressId)
    const addressProductIds = new Set(addressExtras.map(d => d.product_id))

    const finalExtras = [...addressExtras]
    for (const d of defaultExtras) {
        if (!addressProductIds.has(d.product_id)) {
            finalExtras.push(d)
        }
    }
    finalExtras.sort((a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity))

    const extrasMap = {}
    for (const ex of finalExtras) {
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
export async function submitOrder(cart, total, paymentMethod = null, addressId = null, totalCost = 0, costPerItem = {}) {
    if (!supabase) throw new Error('No Supabase connection')

    const orderPayload = {
        total,
        total_cost: Math.round(totalCost),
        payment_method: paymentMethod,
        address_id: addressId,
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
        .select('id, name, amount, is_fixed, created_at, address_id')
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
        .select(`id, total, total_cost, payment_method, created_at,
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
        .select('id, name, amount, is_fixed, created_at, address_id')
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
