import { supabase } from '../lib/supabaseClient'
import * as localRepo from './localRepository'
import type { UUID, Row } from '../types/domain'

// Fetch all recipes from Supabase (Pure isolated by address)
export async function fetchAllRecipes(addressId: UUID | null) {
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

// Upsert a recipe row (insert or update ingredient amount for a product)
export async function upsertRecipe(productId: UUID, ingredient: string, amount: number, addressId: UUID | null = null, unit: string | null = null) {
    if (localRepo.isGuest()) return localRepo.upsertLocalRecipe({ product_id: productId, ingredient, amount, address_id: addressId, unit })
    if (!supabase) throw new Error('No Supabase connection')

    const payload: Row = { product_id: productId, ingredient, amount }
    if (unit) payload.unit = unit
    if (addressId) payload.address_id = addressId

    const { error } = await supabase
        .from('recipes')
        .upsert(payload, { onConflict: 'product_id,ingredient,address_id' })
    if (error) throw error
}

// Delete a recipe row
export async function deleteRecipeRow(productId: UUID, ingredient: string, addressId: UUID | null = null) {
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
