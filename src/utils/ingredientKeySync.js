import { ingredientLabel } from '../components/common/recipeUtils'

/**
 * Detect ingredient key mismatches across recipes / ingredient_costs / inventory_report.
 * Pure function — no DB calls, no side effects.
 *
 * @param {Object} input
 * @param {Array<{ingredient: string}>} input.recipes
 * @param {Object<string, number>} input.ingredientCosts - map key → unit_cost
 * @param {Array<{ingredient: string}>} input.inventoryReport - latest shift_closing.inventory_report
 * @returns {{
 *   orphanRecipeKeys: string[],      // keys in recipes but not in ingredient_costs
 *   orphanInventoryKeys: string[],   // keys in inventory but not in ingredient_costs
 *   labelCollisions: Array<{ label: string, keys: string[] }>,  // same display label, different keys
 *   hasIssues: boolean
 * }}
 */
export function detectKeyMismatches({ recipes = [], ingredientCosts = {}, inventoryReport = [] }) {
    const recipeKeys    = new Set(recipes.map(r => r.ingredient).filter(Boolean))
    const costKeys      = new Set(Object.keys(ingredientCosts || {}))
    const inventoryKeys = new Set((inventoryReport || []).map(i => i.ingredient).filter(Boolean))

    const orphanRecipeKeys    = [...recipeKeys].filter(k => !costKeys.has(k)).sort()
    const orphanInventoryKeys = [...inventoryKeys].filter(k => !costKeys.has(k)).sort()

    // Group all known keys by their display label (case-insensitive)
    const allKeys = new Set([...recipeKeys, ...costKeys, ...inventoryKeys])
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
        labelCollisions,
        hasIssues: orphanRecipeKeys.length > 0
                || orphanInventoryKeys.length > 0
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
