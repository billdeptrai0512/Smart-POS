import { useMemo } from 'react'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, type OnboardingKey } from '../utils/onboardingStorage'

// Read-side counterpart to useOnboardingProgressPersist.ts — for pages that only DISPLAY a
// hint based on progress tracked elsewhere (e.g. RecipeMenuPage/IngredientManagementPage
// reading recipeProgress written by RecipeIngredientPage), not pages that own + write the
// substate themselves (those use useState + useOnboardingProgressPersist instead).
// Memoized on [isGuest, addressId] so re-renders unrelated to those (e.g. drag-and-drop
// frames on RecipeMenuPage) don't re-hit localStorage.getItem + JSON.parse every time.
export function useOnboardingProgress<K extends OnboardingKey>(key: K, { isGuest, addressId }: { isGuest: boolean; addressId?: string | null }) {
    return useMemo(
        () => (isGuest && addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE)[key],
        [key, isGuest, addressId]
    )
}
