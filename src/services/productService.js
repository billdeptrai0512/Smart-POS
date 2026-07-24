import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'

// ---- Products CRUD ----

// Fetch all products for the menu (purely branch isolated)
export async function fetchProducts(addressId) {
    if (localRepo.isGuest()) return localRepo.fetchLocalProducts(addressId)
    if (!supabase) return []

    const run = (cols) => {
        let q = supabase.from('products').select(cols).eq('is_active', true)
        return addressId ? q.eq('owner_address_id', addressId) : q.is('owner_address_id', null)
    }

    let { data: prods, error } = await run('id, name, price, is_active, owner_address_id, sort_order, count_as_cup, is_divider')
    // 42703: cột is_divider chưa có (migration 20260703_menu_divider chưa chạy) → fetch không có nó
    if (error?.code === '42703') {
        ({ data: prods, error } = await run('id, name, price, is_active, owner_address_id, sort_order, count_as_cup'))
    }

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
    // .select() forces PostgREST to return affected rows — without it, an UPDATE
    // silently blocked by RLS (0 rows matched) returns no error at all, and the
    // caller wrongly thinks the save succeeded.
    const { data, error } = await supabase
        .from('products')
        .update({ price })
        .eq('id', productId)
        .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('Không có quyền sửa giá món này (bị chặn bởi RLS hoặc món không tồn tại)')
}

// Rename a product
export async function updateProductName(productId, name) {
    if (localRepo.isGuest()) return localRepo.updateLocalProductName(productId, name)
    if (!supabase) return
    const { error } = await supabase
        .from('products')
        .update({ name })
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

// Create a new product and link to the current address.
// isDivider: dòng tiêu đề phân nhóm menu (không phải món bán) — chỉ gửi cột
// is_divider khi true để insert món thường vẫn chạy trước khi migration apply.
// Mục mới lên đầu (sort_order thấp hơn hết) vì user tạo mục để nhóm lại — đặt
// cuối danh sách thì lẫn vào món cũ, phải kéo lên. Món thường vẫn xuống cuối như cũ.
export async function insertProduct(name, price, addressId = null, isDivider = false) {
    if (localRepo.isGuest()) {
        const existing = localRepo.fetchLocalProducts(addressId)
        const sortOrder = isDivider
            ? Math.min(0, ...existing.map(p => p.sort_order ?? 0)) - 1
            : Math.max(-1, ...existing.map(p => p.sort_order ?? -1)) + 1
        return localRepo.insertLocalProduct({ name, price, owner_address_id: addressId, is_divider: isDivider, sort_order: sortOrder })
    }
    if (!supabase) throw new Error('No Supabase connection')

    const payload = { name, price }
    if (isDivider) payload.is_divider = true
    if (addressId) payload.owner_address_id = addressId

    let query = supabase.from('products').select('sort_order')
    if (addressId) query = query.eq('owner_address_id', addressId)
    else query = query.is('owner_address_id', null)

    if (isDivider) {
        const { data: minRow } = await query.order('sort_order', { ascending: true }).limit(1).maybeSingle()
        payload.sort_order = Math.min(0, minRow?.sort_order ?? 0) - 1
    } else {
        const { data: maxRow } = await query.order('sort_order', { ascending: false }).limit(1).maybeSingle()
        payload.sort_order = (maxRow?.sort_order ?? -1) + 1
    }

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
    if (localRepo.isGuest()) return localRepo.deleteLocalProduct(productId)
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
