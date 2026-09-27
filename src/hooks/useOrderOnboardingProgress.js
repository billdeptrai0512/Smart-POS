import { useMemo, useState } from 'react'
import { norm } from '../utils/onboardingHint'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from './useOnboardingProgressPersist'

// All the guest-tutorial bookkeeping for onboarding step 1 "Tạo đơn" (see onboarding/steps.js) —
// kept out of POSPage's own body so a real shop's POS render isn't paying for tutorial
// matching/state on every tap. Everything here is gated on `isGuest`: OnboardingGuide never
// renders for non-guests anyway, so any of this running for them was pure waste (worse, a
// real shop routinely has a product literally named "Cà phê sữa").
export function useOrderOnboardingProgress({ isGuest, addressId, products, activeItem, enterKey }) {
    // products is a stable ProductContext reference that rarely changes, but POSPage
    // re-renders on every tap (cart state) — memoized so guest sessions don't re-scan the
    // product list on each tap just to find the same two tutorial products.
    const { cafeSuaProduct, cacaoCaPheProduct, matchaProduct } = useMemo(() => ({
        cafeSuaProduct: isGuest ? products.find(p => norm(p.name) === 'cà phê sữa') : undefined,
        cacaoCaPheProduct: isGuest ? products.find(p => norm(p.name) === 'cacao cà phê') : undefined,
        matchaProduct: isGuest ? products.find(p => norm(p.name) === 'matcha cà phê') : undefined,
    }), [isGuest, products])
    const activeProductId = activeItem?.productId
    const isHoldingCafeSua = isGuest && !!cafeSuaProduct && activeProductId === cafeSuaProduct.id
    const isHoldingCacaoCaPhe = isGuest && !!cacaoCaPheProduct && activeProductId === cacaoCaPheProduct.id
    const cacaoCaPheHasLon = isHoldingCacaoCaPhe && (activeItem.extras || []).some(e => norm(e.name) === 'lớn')
    const isHoldingMatcha = isGuest && !!matchaProduct && activeProductId === matchaProduct.id

    // Each drink leg is "reached" the moment the action itself happens — selecting the card,
    // or toggling the extra on — not once the order is sent (waiting for "Tạo đơn" would leave
    // the checklist frozen the whole time drinks are being picked). "Tạo đơn" is its own leg
    // (submitted), ticked by a real submit: enterKey only changes when this device sends an
    // order. Persisted so the guide's checklist (rendered by OnboardingGuide, mounted once
    // at layout level) sees it, and so it survives navigating to /history. Set directly during render
    // (React's documented "adjust state from a derived value" pattern) — the localStorage
    // write (which fires ONBOARDING_EVENT → the guide's setState) can't happen during render,
    // so that part is a separate effect.
    const [orderProgress, setOrderProgress] = useState(() =>
        isGuest && addressId ? readOnboardingState(addressId).orderProgress : DEFAULT_ONBOARDING_STATE.orderProgress
    )
    const patch = {}
    if (isHoldingCafeSua && !orderProgress.cafeSua) patch.cafeSua = true
    if (cacaoCaPheHasLon && !orderProgress.cacaoCaPheLon) patch.cacaoCaPheLon = true
    if (isHoldingMatcha && !orderProgress.matcha) patch.matcha = true
    if (isGuest && enterKey && !orderProgress.submitted) patch.submitted = true
    if (Object.keys(patch).length) setOrderProgress(prev => ({ ...prev, ...patch }))

    useOnboardingProgressPersist('orderProgress', orderProgress, { isGuest, addressId })

    const allDrinksDone = orderProgress.cafeSua && orderProgress.cacaoCaPheLon && orderProgress.matcha
    const showOnboardingHint = isGuest && !!addressId && !(allDrinksDone && orderProgress.viewedHistory)
    // Spotlight sequence: card Cà phê sữa → card Cacao Cà Phê → nút extra "Lớn" → card Matcha Cà Phê.
    const hintStage = !showOnboardingHint || allDrinksDone ? null
        : !orderProgress.cafeSua ? 'cafe'
            : !orderProgress.cacaoCaPheLon ? (isHoldingCacaoCaPhe ? 'lon' : 'cacao')
                : 'matcha'
    // Last legs, outside MenuGrid: nút "Tạo đơn" (CheckoutBar) trước, gửi rồi mới tới Nhật ký
    // (Header) — vào Nhật ký khi chưa gửi thì chẳng có đơn nào để xem. (showOnboardingHint đã
    // loại trường hợp viewedHistory khi allDrinksDone.)
    const lastLeg = showOnboardingHint && allDrinksDone
    const showCheckoutHint = lastLeg && !orderProgress.submitted
    const showHistoryHint = lastLeg && orderProgress.submitted
    // Single spotlight target id for MenuGrid — one lookup instead of a per-stage OR-chain at
    // the call site; 'lon' (extras stage) has no card entry, so no card lights up during it.
    const hintProductId = { cafe: cafeSuaProduct?.id, cacao: cacaoCaPheProduct?.id, matcha: matchaProduct?.id }[hintStage]
    // Same idea for the extras bar — MenuGrid gets a name to match, not the stage enum itself.
    const hintExtraName = hintStage === 'lon' ? 'lớn' : null

    return { hintProductId, hintExtraName, showCheckoutHint, showHistoryHint }
}
