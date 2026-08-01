import { ingredientLabel } from './ingredients'

// Border highlight to suggest an action (vd. "chọn topping ở đây") — reusable className for
// any onboarding step's target element. The CSS animation (.onboarding-hint in index.css,
// same pattern as ProductCard's .tap-pulse) loops forever, stopped by the CALLER removing the
// class — no JS timer/state needed. Plain function (not a hook — safe to call per-item inside
// a .map(), e.g. once per extra button) despite being React-render-time logic.
// variant 'light' (.onboarding-hint-light, also in index.css) is the same animation in white,
// for targets that are themselves primary-colored (vd. Header's Nhật ký card).
export function onboardingHintClass(active, variant = 'default') {
    if (!active) return ''
    return variant === 'light' ? 'onboarding-hint-light' : 'onboarding-hint'
}

// Shared by every onboarding step that matches a target by name (product/extra names) —
// used by MenuGrid.jsx and useOrderOnboardingProgress.js, kept in one place so the matching
// rule (trim + lowercase) can't drift between them.
export function norm(s) {
    return (s || '').trim().toLowerCase()
}

// Finds an entry in a list of { ingredient } rows/configs by LABEL, not a hardcoded key, since
// shops can rename ingredients. Shared by every onboarding phase that spotlights a specific
// ingredient by name so the match rule can't drift between them.
export function findIngredientByLabel(list, label) {
    const target = norm(label)
    return (list || []).find(item => norm(ingredientLabel(item.ingredient)) === target)
}

// "Cà phê" specifically — used by phase 4 (daily report) and phase 7 (stock).
export function findCoffeeIngredient(list) {
    return findIngredientByLabel(list, 'cà phê')
}
