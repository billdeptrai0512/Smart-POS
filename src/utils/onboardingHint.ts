import { ingredientLabel } from './ingredients'

// Border highlight to suggest an action (vd. "chọn topping ở đây") — reusable className for
// any onboarding step's target element. The CSS animation (.onboarding-hint in index.css,
// same pattern as ProductCard's .tap-pulse) loops forever, stopped by the CALLER removing the
// class — no JS timer/state needed. Plain function (not a hook — safe to call per-item inside
// a .map(), e.g. once per extra button) despite being React-render-time logic.
// variant 'solid' (.onboarding-hint-solid, also in index.css) is a detached ring + glow, for targets
// that are themselves primary-colored (Tạo đơn). variant 'soft' (.onboarding-hint-soft) is a pulsing icon (colour + scale) for
// secondary suggestions that sit next to the main hint — put it on the icon, not the whole box.
export function onboardingHintClass(active: unknown, variant = 'default') {
    if (!active) return ''
    return variant === 'solid' ? 'onboarding-hint-solid' : variant === 'soft' ? 'onboarding-hint-soft' : 'onboarding-hint'
}

// Shared by every onboarding step that matches a target by name (product/extra names) —
// used by MenuGrid.tsx and useOrderOnboardingProgress.ts, kept in one place so the matching
// rule (trim + lowercase) can't drift between them.
export function norm(s?: string | null) {
    return (s || '').trim().toLowerCase()
}

// Finds an entry in a list of { ingredient } rows/configs by LABEL, not a hardcoded key, since
// shops can rename ingredients. Shared by every onboarding phase that spotlights a specific
// ingredient by name so the match rule can't drift between them.
export function findIngredientByLabel<T extends { ingredient: string }>(list: T[] | null | undefined, label: string) {
    const target = norm(label)
    return (list || []).find(item => norm(ingredientLabel(item.ingredient)) === target)
}
