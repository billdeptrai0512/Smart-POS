import { useMemo, useState } from 'react'
import { norm } from '../utils/onboardingHint'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from './useOnboardingProgressPersist'

// All the guest-tutorial bookkeeping for onboarding step 1 "Tạo đơn" (see orderStep.jsx) —
// kept out of POSPage's own body so a real shop's POS render isn't paying for tutorial
// matching/state on every tap. Everything here is gated on `isGuest`: OnboardingGuide never
// renders for non-guests anyway, so any of this running for them was pure waste (worse, a
// real shop routinely has a product literally named "Cà phê sữa").
export function useOrderOnboardingProgress({ isGuest, addressId, products, activeItem, requestOnboardingRefresh }) {
    // products is a stable ProductContext reference that rarely changes, but POSPage
    // re-renders on every tap (cart state) — memoized so guest sessions don't re-scan the
    // product list on each tap just to find the same two tutorial products.
    const { cafeSuaProduct, matchaProduct } = useMemo(() => ({
        cafeSuaProduct: isGuest ? products.find(p => norm(p.name) === 'cà phê sữa') : undefined,
        matchaProduct: isGuest ? products.find(p => norm(p.name) === 'matcha cà phê') : undefined,
    }), [isGuest, products])
    const activeProductId = activeItem?.productId
    const isHoldingCafeSua = isGuest && !!cafeSuaProduct && activeProductId === cafeSuaProduct.id
    const cafeSuaHasLon = isHoldingCafeSua && (activeItem.extras || []).some(e => norm(e.name) === 'lớn')
    const isHoldingMatcha = isGuest && !!matchaProduct && activeProductId === matchaProduct.id

    // Each leg is "reached" the moment the action itself happens — holding the card, or
    // toggling the extra on — not once it's actually submitted (the 1-tap model submits on
    // the NEXT tap, which read as a stuck checklist). Persisted so orderStep.jsx's checklist
    // (rendered by OnboardingGuide, mounted once at layout level) sees it, and so it survives
    // navigating to /history for the 3rd requirement there. Set directly during render
    // (React's documented "adjust state from a derived value" pattern) — the localStorage
    // write + requestOnboardingRefresh() (an ancestor's setState) can't happen during render,
    // so that part is a separate effect.
    const [orderProgress, setOrderProgress] = useState(() =>
        isGuest && addressId ? readOnboardingState(addressId).orderProgress : DEFAULT_ONBOARDING_STATE.orderProgress
    )
    if (cafeSuaHasLon && !orderProgress.cafeSuaLon) setOrderProgress(prev => ({ ...prev, cafeSuaLon: true }))
    if (isHoldingMatcha && !orderProgress.matcha) setOrderProgress(prev => ({ ...prev, matcha: true }))

    useOnboardingProgressPersist('orderProgress', orderProgress, { isGuest, addressId, requestOnboardingRefresh })

    const showOnboardingHint = isGuest && !!addressId && !(orderProgress.cafeSuaLon && orderProgress.matcha && orderProgress.viewedHistory)
    // Spotlight sequence: card Cà phê sữa → nút extra "Lớn" → card Matcha Cà Phê (MenuGrid).
    const hintStage = !showOnboardingHint || (orderProgress.cafeSuaLon && orderProgress.matcha) ? null
        : orderProgress.cafeSuaLon ? 'matcha'
            : isHoldingCafeSua ? 'lon'
                : 'cafe'
    // 4th leg of the same sequence, but the target (Nhật ký) lives in Header, not MenuGrid —
    // picks up right where hintStage leaves off (both drink legs done, still missing the visit).
    const showHistoryHint = showOnboardingHint && orderProgress.cafeSuaLon && orderProgress.matcha && !orderProgress.viewedHistory

    return { hintStage, showHistoryHint, cafeSuaProductId: cafeSuaProduct?.id, matchaProductId: matchaProduct?.id }
}
