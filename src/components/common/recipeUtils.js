import { INGREDIENT_NAMES } from '../../constants'

// ALL_INGREDIENTS is now empty — all ingredients are fetched from DB
export const ALL_INGREDIENTS = []

// Display order matters: used as the section order in /ingredients > Báo cáo.
// `null` (chưa phân loại) is rendered before these by the report view so managers
// see what still needs assigning at the top.
export const INGREDIENT_CATEGORIES = [
    { key: 'main',      label: 'Nguyên liệu chính' },
    { key: 'packaging', label: 'Bao bì' },
    { key: 'tools',     label: 'Đồ dùng / Dụng cụ' },
]

export const INGREDIENT_CATEGORY_LABELS = {
    main: 'Nguyên liệu chính',
    packaging: 'Bao bì',
    tools: 'Đồ dùng / Dụng cụ',
}

export function ingredientCategoryLabel(key) {
    if (!key) return 'Chưa phân loại'
    return INGREDIENT_CATEGORY_LABELS[key] || 'Chưa phân loại'
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
