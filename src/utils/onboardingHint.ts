import { ingredientLabel } from './ingredients'

// Border highlight to suggest an action (vd. "chọn topping ở đây") — reusable className for
// any onboarding step's target element. The CSS animation (.onboarding-hint in index.css,
// same pattern as ProductCard's .tap-pulse) loops forever, stopped by the CALLER removing the
// class — no JS timer/state needed. Plain function (not a hook — safe to call per-item inside
// a .map(), e.g. once per extra button) despite being React-render-time logic.
// variant 'solid' (.onboarding-hint-solid, also in index.css) is a detached ring + glow, for targets
// that are themselves primary-colored (Tạo đơn).
export function onboardingHintClass(active: unknown, variant = 'default') {
    if (!active) return ''
    return variant === 'solid' ? 'onboarding-hint-solid' : 'onboarding-hint'
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

// "Cà phê" specifically — used by phase 4 (daily report) và phase 6 (cài đặt nguyên liệu).
export function findCoffeeIngredient<T extends { ingredient: string }>(list: T[] | null | undefined) {
    return findIngredientByLabel(list, 'cà phê')
}

// Phase 6 "Cài đặt nguyên liệu" — 4 việc cần làm cho đúng 1 ingredient mẫu (Cà phê), theo đúng
// thứ tự hiện trên UI: tồn kho cuối ngày (cờ warehouse_stock_set) + 3 field cấu hình đọc thẳng
// từ ingredientConfigs. Checklist bước 6 (onboarding/steps.ts) và hint từng field cùng đọc 1 danh
// sách này nên không lệch nhau.
export interface IngredientSetupConfig { pack_size?: number | null; pack_unit?: string | null; min_stock?: number | null; tare_weight?: number | null; [other: string]: unknown }
export const INGREDIENT_SETUP_FIELDS: { key: string; label: string; done: (c: IngredientSetupConfig | null | undefined, warehouseStockSet?: boolean) => boolean }[] = [
    { key: 'warehouse', label: 'Nhập tồn kho cuối ngày', done: (_c, warehouseStockSet) => !!warehouseStockSet },
    { key: 'pack', label: 'Cài quy đổi', done: (c) => !!(c?.pack_size && c?.pack_unit) },
    { key: 'minStock', label: 'Cài tồn kho tối thiểu', done: (c) => c?.min_stock != null },
    { key: 'tare', label: 'Cài khối lượng bì', done: (c) => c?.tare_weight != null && c.tare_weight > 0 },
]

// Field ĐẦU TIÊN chưa xong, hoặc null nếu xong cả 4 — IngredientManagementPage.tsx (hint thẻ
// trong list), IngredientDetailPage.tsx (hint từng field trên trang chi tiết).
export function nextIngredientSetupField(config: IngredientSetupConfig | null | undefined, warehouseStockSet?: boolean) {
    return INGREDIENT_SETUP_FIELDS.find(f => !f.done(config, warehouseStockSet))?.key ?? null
}
