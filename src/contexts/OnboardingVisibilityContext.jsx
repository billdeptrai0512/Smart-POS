import { createContext, useContext, useState, useCallback } from 'react'

// Lets a page adjust the global onboarding guide (see App.jsx's OnboardingLayout):
//   - hidden: fully hide it (e.g. sort-mode's Hủy/Lưu bar spans the same fixed bottom-0 area).
//   - bottomOffset: push it up by N px (e.g. a page's own persistent bottom tab bar — not
//     `position:fixed` content, which the guide would already sit above, but real layout
//     space at the true screen bottom that the guide's `fixed bottom-*` would otherwise cover).
//   - requestRefresh: the guide only re-fetches its checklist data on mount/tab-visibility
//     (it's mounted once at the layout level, not per-page) — a page that just wrote data the
//     checklist depends on (e.g. saved thực thu/kiểm kê tồn kho) calls this to force a re-fetch.
const OnboardingVisibilityContext = createContext({
    hidden: false, setHidden: () => {},
    bottomOffset: 0, setBottomOffset: () => {},
    refreshToken: 0, requestRefresh: () => {},
})

export function OnboardingVisibilityProvider({ children }) {
    const [hidden, setHidden] = useState(false)
    const [bottomOffset, setBottomOffset] = useState(0)
    const [refreshToken, setRefreshToken] = useState(0)
    const requestRefresh = useCallback(() => setRefreshToken(t => t + 1), [])
    return (
        <OnboardingVisibilityContext.Provider value={{ hidden, setHidden, bottomOffset, setBottomOffset, refreshToken, requestRefresh }}>
            {children}
        </OnboardingVisibilityContext.Provider>
    )
}

export function useOnboardingVisibility() {
    return useContext(OnboardingVisibilityContext)
}
