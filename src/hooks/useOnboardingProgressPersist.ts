import { useEffect, useRef } from 'react'
import { writeOnboardingState, type OnboardingKey } from '../utils/onboardingStorage'

// Shared "skip first run, then persist" pattern — the initial value of any onboarding progress
// state IS what's already in storage, so writing it straight back on every mount is pure
// waste; only a REAL change (after mount) should write (writeOnboardingState also pings the guide). Used by both orderProgress
// (useOrderOnboardingProgress.ts) and journalProgress (HistoryPage.tsx).
export function useOnboardingProgressPersist(key: OnboardingKey, progress: unknown, { isGuest, addressId }: { isGuest: boolean; addressId?: string | null }) {
    const isFirstRun = useRef(true)
    useEffect(() => {
        if (isFirstRun.current) { isFirstRun.current = false; return }
        if (!isGuest || !addressId) return
        writeOnboardingState(addressId, { [key]: progress } as Parameters<typeof writeOnboardingState>[1])
    }, [key, progress, isGuest, addressId])
}
