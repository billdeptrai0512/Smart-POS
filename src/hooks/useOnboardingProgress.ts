import { useMemo, useSyncExternalStore } from 'react'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, ONBOARDING_EVENT, type OnboardingKey } from '../utils/onboardingStorage'

const subscribe = (cb: () => void) => { window.addEventListener(ONBOARDING_EVENT, cb); return () => window.removeEventListener(ONBOARDING_EVENT, cb) }

// Read-side counterpart to useOnboardingProgressPersist.ts — for pages that only DISPLAY a
// hint based on progress tracked elsewhere (e.g. InventoryAuditTab reading cashFlowProgress
// written by DailyReportPage), not pages that own + write the
// substate themselves (those use useState + useOnboardingProgressPersist instead).
// Sống theo ONBOARDING_EVENT (trang khác/component khác ghi xong là thấy ngay, vd nhập kho xong → sáng mũi tên về
// Báo cáo). Snapshot là chuỗi JSON (so sánh được theo giá trị), parse lại chỉ khi chuỗi đổi.
export function useOnboardingProgress<K extends OnboardingKey>(key: K, { isGuest, addressId }: { isGuest: boolean; addressId?: string | null }) {
    const raw = useSyncExternalStore(subscribe, () => (isGuest && addressId ? JSON.stringify(readOnboardingState(addressId)[key]) : ''))
    return useMemo(() => (raw ? JSON.parse(raw) : DEFAULT_ONBOARDING_STATE[key]) as typeof DEFAULT_ONBOARDING_STATE[K], [raw, key])
}
