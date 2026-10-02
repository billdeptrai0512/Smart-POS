import { useMemo, useState } from 'react'
import { norm } from '../utils/onboardingHint'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from './useOnboardingProgressPersist'

// Đơn 1 = cà phê sữa; đơn 2 = bạc xỉu (ít ngọt) + cacao cà phê (lớn) + matcha cà phê (lớn, hơi
// ngọt). p = tên món, x = extra bắt buộc, theo thứ tự cần bấm.
const ORDERS = [
    [{ p: 'cà phê sữa', x: [] }],
    [
        { p: 'bạc xỉu', x: ['ít ngọt'] },
        { p: 'cacao cà phê', x: ['lớn'] },
        { p: 'matcha cà phê', x: ['lớn', 'hơi ngọt'] },
    ],
]
const hasExtra = (item, name) => (item.extras || []).some(e => norm(e.name) === name)

// All the guest-tutorial bookkeeping for onboarding step 1 "Tạo đơn" (see onboarding/steps.js) —
// kept out of POSPage's own body so a real shop's POS render isn't paying for tutorial
// matching/state on every tap. Everything here is gated on `isGuest`: OnboardingGuide never
// renders for non-guests anyway, so any of this running for them was pure waste (worse, a
// real shop routinely has a product literally named "Cà phê sữa").
//
// Chỉ `sent` (số đơn đã gửi thật, 0..2) được lưu; "đơn hiện tại đủ món chưa" suy thẳng từ giỏ.
export function useOrderOnboardingProgress({ isGuest, addressId, products, cart, enterKey }) {
    // products is a stable ProductContext reference that rarely changes, but POSPage
    // re-renders on every tap (cart state) — memoized so guest sessions don't re-scan the
    // product list on each tap just to find the tutorial products.
    const orders = useMemo(() => isGuest
        ? ORDERS.map(rows => rows.map(r => ({ ...r, id: products.find(p => norm(p.name) === r.p)?.id })))
        : [], [isGuest, products])

    // Persisted so it survives navigating to /history. Set directly during render (React's
    // documented "adjust state from a derived value" pattern) — the localStorage write (which
    // fires ONBOARDING_EVENT → the guide's setState) can't happen during render, so that part
    // is a separate effect.
    const [orderProgress, setOrderProgress] = useState(() =>
        isGuest && addressId ? readOnboardingState(addressId).orderProgress : DEFAULT_ONBOARDING_STATE.orderProgress
    )
    const sent = orderProgress.sent || 0
    const allSent = sent >= 2

    const pending = (orders[sent] || []).find(r =>
        !cart.some(i => i.productId === r.id && r.x.every(e => hasExtra(i, e))))
    const orderReady = isGuest && !allSent && !!orders[sent] && !pending

    // enterKey đổi mỗi lần gửi đơn thật — lúc đó giỏ đã bị dọn, nên đếm theo `ready` của lần
    // render TRƯỚC (state, không phải ref). Gửi đơn thiếu món thì không tăng `sent`.
    const [seenKey, setSeenKey] = useState(enterKey)
    const [ready, setReady] = useState(false)
    if (enterKey !== seenKey) {
        setSeenKey(enterKey)
        if (isGuest && enterKey && ready) setOrderProgress(prev => ({ ...prev, sent: sent + 1 }))
    }
    if (ready !== orderReady) setReady(orderReady)

    useOnboardingProgressPersist('orderProgress', orderProgress, { isGuest, addressId })

    const showOnboardingHint = isGuest && !!addressId && !(allSent && orderProgress.viewedHistory)
    // Spotlight theo món/extra đầu tiên còn thiếu của đơn hiện tại: chưa cầm món → sáng card;
    // đang cầm đúng món đó → sáng extra kế tiếp. Đủ món thì sáng "Tạo đơn" (CheckoutBar); gửi đủ
    // 2 đơn mới tới Nhật ký (Header) — vào sớm thì chưa có đủ đơn để xem.
    const target = showOnboardingHint && !allSent ? pending : undefined
    const active = cart[cart.length - 1]
    const holding = !!target && active?.productId === target.id
    const hintProductId = target && !holding ? target.id : undefined
    const hintExtraName = holding ? target.x.find(e => !hasExtra(active, e)) ?? null : null
    const showCheckoutHint = showOnboardingHint && orderReady
    const showHistoryHint = showOnboardingHint && allSent

    return { hintProductId, hintExtraName, showCheckoutHint, showHistoryHint }
}
