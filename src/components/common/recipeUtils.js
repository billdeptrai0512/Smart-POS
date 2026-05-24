import { INGREDIENT_NAMES } from '../../constants'

// ALL_INGREDIENTS is now empty — all ingredients are fetched from DB
export const ALL_INGREDIENTS = []

// Display order matters: used as the tab order in /ingredients.
// `null` (chưa phân loại) folds into 'main' per UX rule.
// `tools` is a legacy value (kept for old DB rows) — folded into 'packaging' everywhere.
export const INGREDIENT_CATEGORIES = [
    { key: 'main',      label: 'Nguyên liệu chính' },
    { key: 'packaging', label: 'Bao bì' },
]

export const INGREDIENT_CATEGORY_LABELS = {
    main: 'Nguyên liệu chính',
    packaging: 'Bao bì',
}

export function ingredientCategoryLabel(key) {
    if (!key) return 'Chưa phân loại'
    return INGREDIENT_CATEGORY_LABELS[key] || 'Chưa phân loại'
}

// Coerce raw category value into the active 2-tab set.
// null / unknown → 'main'; legacy 'tools' → 'packaging'.
export function normalizeIngredientCategory(raw) {
    if (raw === 'packaging' || raw === 'tools') return 'packaging'
    return 'main'
}

export function sortIngredients(a, b, customOrderArray) {
    if (customOrderArray && customOrderArray.length > 0) {
        const idxA = customOrderArray.indexOf(a)
        const idxB = customOrderArray.indexOf(b)
        if (idxA !== -1 && idxB !== -1) return idxA - idxB
        if (idxA !== -1) return -1
        if (idxB !== -1) return 1
    }
    return a.localeCompare(b)
}

export function ingredientLabel(key) {
    if (INGREDIENT_NAMES[key]) return INGREDIENT_NAMES[key]
    // Capitalize first letter, replace underscores with spaces
    const name = key.replace(/_/g, ' ')
    return name.charAt(0).toUpperCase() + name.slice(1)
}

export function getIngredientUnit(key, storedUnit, ingredientUnits) {
    // Prefer DB-stored unit if available and not the default placeholder
    if (storedUnit && storedUnit !== 'đv') return storedUnit;
    // Fall back to ingredient_costs unit map
    if (ingredientUnits?.[key] && ingredientUnits[key] !== 'đv') return ingredientUnits[key];
    if (key.endsWith('_g')) return 'g';
    if (key.endsWith('_ml')) return 'ml';
    if (key === 'cup') return 'ly';
    if (key === 'lid') return 'nắp';
    if (key === 'tea_bag') return 'gói';
    if (key === 'orange') return 'quả';
    return storedUnit || ingredientUnits?.[key] || 'đv';
}
