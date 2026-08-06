// Shared between OnboardingGuide.jsx (reads/writes it), MenuGrid.jsx + HistoryPage.jsx (write
// step-1 progress into it from /pos and /history respectively), and localRepository.ts (clears
// it on a fresh guest init) — bump ALL call sites together if the storage shape changes, or one
// side silently reads/resets/writes the wrong key or shape.
export const ONBOARDING_STORAGE_PREFIX = 'onboarding_v4_'

// orderProgress tracks bước 1 "Tạo đơn"'s 3 sub-goals independently of any single order really
// landing in the DB — see orderStep.jsx for why (1-tap POS model means "submitted" lags "did
// the thing" by one tap, which read as a stuck checklist).
// journalProgress tracks phase 2 "Nhật ký"'s 3 tab-visit flags on /history (Thu nhập/Chi
// phí/Báo cáo — xem HistoryTabsBar.jsx), viewedIncome tick ngay vì đó là tab mặc định —
// written from HistoryPage.jsx (see journalStep.jsx).
// cashFlowProgress (phase 3) + inventoryProgress (phase 4) tracked from DailyReportPage.jsx —
// xem cashReportStep.jsx/inventoryStep.jsx. Cờ chỉ set true, không bao giờ revert, để tránh
// guide tái xuất hiện khi dữ liệu hôm sau reset (actual_cash/inventory_report chỉ có nghĩa
// "hôm nay").
// recipeProgress (phase 5) tracked from RecipeIngredientPage.jsx khi user điền định lượng +
// tạo tùy chọn thêm cho công thức "Cà phê đen" — xem recipeStep.jsx.
export const DEFAULT_ONBOARDING_STATE = {
    collapsed: false,
    orderProgress: { cafeSua: false, cacaoCaPheLon: false, matcha: false, viewedHistory: false },
    journalProgress: { viewedIncome: false, viewedExpense: false, viewedReport: false },
    cashFlowProgress: { cash: false, transfer: false },
    inventoryProgress: { coffee: false, cacao: false },
    recipeProgress: { filledAmount: false, addedExtra: false },
}

// Phase 5 "Công thức" is done once both sub-goals are ticked — shared by recipeStep.jsx and
// every page (phase 7) that gates a hint on "has phase 5 finished".
export function isRecipeProgressDone(recipeProgress) {
    return recipeProgress.filledAmount && recipeProgress.addedExtra
}

// Phase 3 "Kết ca đếm tiền" — shared by cashReportStep.jsx and DailyReportPage.jsx (which
// needs the same "is this phase done" check to gate phase 4's hint sequence).
export function isCashFlowProgressDone(cashFlowProgress) {
    return cashFlowProgress.cash && cashFlowProgress.transfer
}

// Phase 4 "Kiểm kê tồn kho" — shared by inventoryStep.jsx and DailyReportPage.jsx (same
// reason as isCashFlowProgressDone above).
export function isInventoryProgressDone(inventoryProgress) {
    return inventoryProgress.coffee && inventoryProgress.cacao
}

export function readOnboardingState(addressId, fallback = DEFAULT_ONBOARDING_STATE) {
    try {
        const raw = localStorage.getItem(ONBOARDING_STORAGE_PREFIX + addressId)
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
    } catch { return fallback }
}

// Shallow-patches whatever's already stored so sibling top-level keys (e.g. `collapsed`)
// survive — callers touching `orderProgress` must pass the whole updated sub-object themselves.
export function writeOnboardingState(addressId, patch) {
    const next = { ...readOnboardingState(addressId), ...patch }
    try { localStorage.setItem(ONBOARDING_STORAGE_PREFIX + addressId, JSON.stringify(next)) } catch { /* ignore */ }
}
