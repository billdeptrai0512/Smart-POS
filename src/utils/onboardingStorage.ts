// Tiến độ guide khách dùng thử (onboarding/steps.ts đọc qua OnboardingGuide.tsx). Mỗi trang ghi phần
// của mình; localRepository.ts xoá khi vào dùng thử mới — đổi shape thì tăng prefix để bản cũ bị bỏ.
import { readJSON, writeJSON } from './storage'

export const ONBOARDING_STORAGE_PREFIX = 'onboarding_v5_'

// Cờ chỉ set true, không bao giờ revert, để guide khỏi tái xuất hiện khi dữ liệu hôm sau reset
// (actual_cash/inventory_report chỉ có nghĩa "hôm nay"). Riêng `ready`/số đếm là trạng thái sống.
export const DEFAULT_ONBOARDING_STATE = {
    // Bước 1 "Chuẩn bị" — PrepPinBar.tsx: opened = đã mở dải; taken/total = số món đã lấy / cần lấy; done chốt khi lấy đủ.
    prepProgress: { opened: false, taken: 0, total: 0, done: false },
    // Bước 2 "Bán hàng" — useOrderOnboardingProgress.ts: sent = số đơn đã gửi; ready = giỏ đang có món (không latch).
    // viewedHistory: đã vào Nhật ký sau khi bán (HistoryPage.tsx).
    orderProgress: { sent: 0, ready: false, viewedHistory: false },
    // Bước 3 "Nhật ký" — HistoryPage.tsx: viewedReport = bấm mũi tên "tiến" sang Báo cáo.
    journalProgress: { viewedIncome: false, viewedExpense: false, viewedReport: false },
    // Bước 4 "Kết ca" — DailyReportPage.tsx. expectCash/expectTransfer = số guide đọc ra để két lệch 20k so với doanh thu.
    cashFlowProgress: { cash: false, transfer: false, expectCash: 0, expectTransfer: 0 },
    // Bước 5 "Kiểm kê" — tab Kiểm kê của /inventory. coffee: đã lưu Cuối kỳ cà phê; suggest: số cà phê móm sẵn vào ô Cuối kỳ (Lý thuyết − phần ly pha không bill).
    inventoryProgress: { coffee: false, suggest: 0 },
    // Bước 6 "Bổ sung tồn kho" — WarehousePrepNotice.tsx: bought = đã nhập kho mẫu 1 món (app nhập nốt phần còn lại).
    // viewedNet: đã quay về Báo cáo xem Thực nhận cuối ngày sau khi chi tiền nhập kho (DailyReportPage.tsx).
    restockProgress: { bought: false, viewedNet: false },
}

export type OnboardingState = typeof DEFAULT_ONBOARDING_STATE
export type OnboardingKey = keyof OnboardingState

// Phát trong cùng tab sau mỗi lần ghi (sự kiện 'storage' gốc chỉ bắn sang tab KHÁC) —
// OnboardingGuide (mount 1 lần ở layout) nghe cái này để đọc lại, khỏi trang nào ghi cũng
// phải tự báo.
export const ONBOARDING_EVENT = 'onboarding-change'

export function isCashFlowProgressDone(cashFlowProgress: { cash: boolean; transfer: boolean }) {
    return cashFlowProgress.cash && cashFlowProgress.transfer
}

// Chỉ đếm cà phê: ly/nắp là cùng một thao tác.
export function isInventoryProgressDone(inventoryProgress: Pick<OnboardingState['inventoryProgress'], 'coffee'>) {
    return inventoryProgress.coffee
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
