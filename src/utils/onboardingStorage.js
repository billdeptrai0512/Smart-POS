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
export const DEFAULT_ONBOARDING_STATE = {
    collapsed: false,
    orderProgress: { cafeSuaLon: false, matcha: false, viewedHistory: false },
    journalProgress: { viewedIncome: false, viewedExpense: false, viewedReport: false },
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
