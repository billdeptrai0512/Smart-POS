import { ingredientLabel } from './ingredients'

/**
 * Detect ingredient key mismatches across recipes / ingredient_costs / inventory_report
 * AND extra-ingredient assignments. Pure function — no DB calls, no side effects.
 *
 * @param {Object} input
 * @param {Array<{ingredient: string}>} input.recipes - base recipe rows
 * @param {Object<string, number>} input.ingredientCosts - map key → unit_cost
 * @param {Array<{ingredient: string}>} input.inventoryReport - latest shift_closing.inventory_report
 * @param {Object<string, Array<{ingredient: string, extra_id?: string}>>} [input.extraIngredients]
 *        Map extraId → list of extra-ingredient impacts. From ProductContext.
 * @returns {{
 *   orphanRecipeKeys: string[],          // keys in recipes but not in ingredient_costs
 *   orphanInventoryKeys: string[],       // keys in inventory but not in ingredient_costs
 *   orphanExtraIngredientKeys: string[], // keys assigned to extras but not in ingredient_costs
 *   labelCollisions: Array<{ label: string, keys: string[] }>,  // same display label, different keys
 *   hasIssues: boolean
 * }}
 */
export function detectKeyMismatches({
    recipes = [],
    ingredientCosts = {},
    inventoryReport = [],
    extraIngredients = {},
    ignoredKeys = null,   // Set<string> | null — orphan keys the user has chosen to suppress
}) {
    const recipeKeys    = new Set(recipes.map(r => r.ingredient).filter(Boolean))
    const costKeys      = new Set(Object.keys(ingredientCosts || {}))
    const inventoryKeys = new Set((inventoryReport || []).map(i => i.ingredient).filter(Boolean))
    const ignored = ignoredKeys instanceof Set ? ignoredKeys : new Set(ignoredKeys || [])

    // Flatten extra-ingredient assignments — each extra has [{ ingredient, ... }, ...].
    // An orphan here is critical: hao hụt calc reads recipe + extra ingredients to estimate
    // consumption; missing keys silently get cost=0 → mất tiền invisible.
    const extraIngKeys = new Set()
    for (const list of Object.values(extraIngredients || {})) {
        if (!Array.isArray(list)) continue
        for (const ei of list) {
            if (ei?.ingredient) extraIngKeys.add(ei.ingredient)
        }
    }

    const orphanRecipeKeys         = [...recipeKeys].filter(k => !costKeys.has(k) && !ignored.has(k)).sort()
    const orphanInventoryKeys      = [...inventoryKeys].filter(k => !costKeys.has(k) && !ignored.has(k)).sort()
    const orphanExtraIngredientKeys = [...extraIngKeys].filter(k => !costKeys.has(k) && !ignored.has(k)).sort()

    // Group all known keys by their display label (case-insensitive)
    const allKeys = new Set([...recipeKeys, ...costKeys, ...inventoryKeys, ...extraIngKeys])
    const byLabel = new Map()
    for (const key of allKeys) {
        const label = ingredientLabel(key).toLowerCase().trim()
        if (!byLabel.has(label)) byLabel.set(label, [])
        byLabel.get(label).push(key)
    }

    const labelCollisions = [...byLabel.entries()]
        .filter(([, keys]) => keys.length > 1)
        .map(([, keys]) => ({
            label: ingredientLabel(keys[0]),
            keys: keys.slice().sort()
        }))

    return {
        orphanRecipeKeys,
        orphanInventoryKeys,
        orphanExtraIngredientKeys,
        labelCollisions,
        hasIssues: orphanRecipeKeys.length > 0
                || orphanInventoryKeys.length > 0
                || orphanExtraIngredientKeys.length > 0
                || labelCollisions.length > 0
    }
}

/**
 * Pick canonical key from a collision group. Heuristic: prefer keys that appear in
 * ingredient_costs (user-managed) over orphan recipe/inventory keys.
 */
export function suggestCanonical(collision, ingredientCosts = {}) {
    const costKeys = new Set(Object.keys(ingredientCosts))
    const inCosts = collision.keys.filter(k => costKeys.has(k))
    if (inCosts.length === 1) return inCosts[0]
    // Multiple in costs (or none) — fall back to alphabetical first
    return collision.keys[0]
}
