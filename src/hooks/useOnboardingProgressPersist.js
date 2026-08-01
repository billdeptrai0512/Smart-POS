import { useEffect, useRef } from 'react'
import { writeOnboardingState } from '../utils/onboardingStorage'

// Shared "skip first run, then persist + refresh guide" pattern — the initial value of any
// onboarding progress state IS what's already in storage, so writing it straight back +
// forcing OnboardingGuide's full reload() (4 network calls) on every mount is pure waste;
// only a REAL change (after mount) should write + refresh. Used by both orderProgress
// (useOrderOnboardingProgress.js) and journalProgress (HistoryPage.jsx).
export function useOnboardingProgressPersist(key, progress, { isGuest, addressId, requestOnboardingRefresh }) {
    const isFirstRun = useRef(true)
    useEffect(() => {
        if (isFirstRun.current) { isFirstRun.current = false; return }
        if (!isGuest || !addressId) return
        writeOnboardingState(addressId, { [key]: progress })
        requestOnboardingRefresh()
    }, [key, progress, isGuest, addressId, requestOnboardingRefresh])
}
