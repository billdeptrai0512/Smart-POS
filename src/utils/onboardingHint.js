// Border highlight to suggest an action (vd. "chọn topping ở đây") — reusable className for
// any onboarding step's target element. The CSS animation (.onboarding-hint in index.css,
// same pattern as ProductCard's .tap-pulse) loops forever, stopped by the CALLER removing the
// class — no JS timer/state needed. Plain function (not a hook — safe to call per-item inside
// a .map(), e.g. once per extra button) despite being React-render-time logic.
export function onboardingHintClass(active) {
    return active ? 'onboarding-hint' : ''
}

// Shared by every onboarding step that matches a target by name (product/extra names) —
// used by MenuGrid.jsx and useOrderOnboardingProgress.js, kept in one place so the matching
// rule (trim + lowercase) can't drift between them.
export function norm(s) {
    return (s || '').trim().toLowerCase()
}
