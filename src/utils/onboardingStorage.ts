// Shared between OnboardingGuide.tsx (reads it), MenuGrid.tsx + HistoryPage.tsx (write
// step-1 progress into it from /pos and /history respectively), and localRepository.ts (clears
// it on a fresh guest init) — bump ALL call sites together if the storage shape changes, or one
// side silently reads/resets/writes the wrong key or shape.
import { readJSON, writeJSON } from './storage'

export const ONBOARDING_STORAGE_PREFIX = 'onboarding_v4_'

// orderProgress tracks bước 1 "Tạo đơn": `sent` = số đơn đã gửi thật (0..2) + `picked` = số món đã
// chọn đủ của đơn 2 (xem useOrderOnboardingProgress.ts); viewedHistory là mốc chuyển sang Nhật ký.
// journalProgress tracks phase 2 "Nhật ký"'s 3 tab-visit flags on /history (Thu nhập/Chi
// phí/Báo cáo — xem HistoryTabsBar.tsx), viewedIncome tick ngay vì đó là tab mặc định —
// written from HistoryPage.tsx (see onboarding/steps.ts).
// cashFlowProgress (phase 3) + inventoryProgress (phase 4) tracked from DailyReportPage.tsx —
// xem onboarding/steps.ts. Cờ chỉ set true, không bao giờ revert, để tránh
// guide tái xuất hiện khi dữ liệu hôm sau reset (actual_cash/inventory_report chỉ có nghĩa
// "hôm nay").
// recipeProgress (phase 5) tracked from RecipeIngredientPage.tsx khi user điền định lượng +
// tạo tùy chọn thêm cho công thức "Cà phê đen" — xem onboarding/steps.ts.
export const DEFAULT_ONBOARDING_STATE = {
    orderProgress: { sent: 0, picked: 0, viewedHistory: false },
    journalProgress: { viewedIncome: false, viewedExpense: false, viewedReport: false },
    cashFlowProgress: { scrolled: false, cash: false, transfer: false },
    inventoryProgress: { coffee: false, cacao: false },
    recipeProgress: { filledAmount: false, addedExtra: false },
    // Bước 6: kho Cà phê đã nhập — ghi từ IngredientDetailPage.tsx.
    stockProgress: { coffeeWarehouseSet: false },
}

export type OnboardingState = typeof DEFAULT_ONBOARDING_STATE
export type OnboardingKey = keyof OnboardingState

// Phát trong cùng tab sau mỗi lần ghi (sự kiện 'storage' gốc chỉ bắn sang tab KHÁC) —
// OnboardingGuide (mount 1 lần ở layout) nghe cái này để đọc lại, khỏi trang nào ghi cũng
// phải tự báo.
export const ONBOARDING_EVENT = 'onboarding-change'

// Phase 5 "Công thức" is done once both sub-goals are ticked — shared by onboarding/steps.ts and
// every page (phase 7) that gates a hint on "has phase 5 finished".
export function isRecipeProgressDone(recipeProgress: { filledAmount: boolean; addedExtra: boolean }) {
    return recipeProgress.filledAmount && recipeProgress.addedExtra
}

// Phase 3 "Kết ca đếm tiền" — shared by DailyReportPage.tsx (which
// needs the same "is this phase done" check to gate phase 4's hint sequence).
export function isCashFlowProgressDone(cashFlowProgress: { cash: boolean; transfer: boolean }) {
    return cashFlowProgress.cash && cashFlowProgress.transfer
}

// Việc "Kéo xuống" của phase 3 — thẻ Thực thu đã hiện trọn (scrolled), hoặc đã gõ tiền thì
// chắc chắn đã kéo tới (phiên cũ chưa có cờ scrolled không bị lùi về việc này).
export function reachedCashCard(cashFlowProgress: { scrolled: boolean; cash: boolean; transfer: boolean }) {
    return cashFlowProgress.scrolled || cashFlowProgress.cash || cashFlowProgress.transfer
}

// Phase 4 "Kiểm kê tồn kho" — shared by DailyReportPage.tsx (same
// reason as isCashFlowProgressDone above).
export function isInventoryProgressDone(inventoryProgress: { coffee: boolean; cacao: boolean }) {
    return inventoryProgress.coffee && inventoryProgress.cacao
}

export function readOnboardingState(addressId: string, fallback = DEFAULT_ONBOARDING_STATE): typeof DEFAULT_ONBOARDING_STATE {
    const stored = readJSON<Partial<typeof DEFAULT_ONBOARDING_STATE> | null>(ONBOARDING_STORAGE_PREFIX + addressId, null)
    return stored ? { ...fallback, ...stored } : fallback
}

// Shallow-patches whatever's already stored so sibling top-level keys (e.g. `journalProgress`)
// survive — callers touching `orderProgress` must pass the whole updated sub-object themselves.
export function writeOnboardingState(addressId: string, patch: Partial<typeof DEFAULT_ONBOARDING_STATE>) {
    const next = { ...readOnboardingState(addressId), ...patch }
    writeJSON(ONBOARDING_STORAGE_PREFIX + addressId, next)
    window.dispatchEvent(new Event(ONBOARDING_EVENT))
}
