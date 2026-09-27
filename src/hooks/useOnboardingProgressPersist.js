import { useEffect, useRef } from 'react'
import { writeOnboardingState } from '../utils/onboardingStorage'

// Shared "skip first run, then persist" pattern — the initial value of any onboarding progress
// state IS what's already in storage, so writing it straight back on every mount is pure
// waste; only a REAL change (after mount) should write (writeOnboardingState also pings the guide). Used by both orderProgress
// (useOrderOnboardingProgress.js) and journalProgress (HistoryPage.jsx).
export function useOnboardingProgressPersist(key, progress, { isGuest, addressId }) {
    const isFirstRun = useRef(true)
    useEffect(() => {
        if (isFirstRun.current) { isFirstRun.current = false; return }
        if (!isGuest || !addressId) return
        writeOnboardingState(addressId, { [key]: progress })
    }, [key, progress, isGuest, addressId])
}
