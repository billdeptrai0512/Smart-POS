import { useState, useMemo } from 'react'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE } from '../utils/onboardingStorage'
import { useOnboardingProgressPersist } from './useOnboardingProgressPersist'
import { useOnboardingProgress } from './useOnboardingProgress'
import { norm } from '../utils/onboardingHint'
import type { CartItem, Row } from '../types/domain'

// Đơn mẫu của bước 2: lấy hàng xong → sáng CÙNG LÚC mọi món chưa có trong giỏ → đủ cả thì mới sáng "Tạo đơn".
const ORDER = ['cà phê đen', 'cà phê sữa']

// Bước 2 "Bán hàng" của guide khách dùng thử (onboarding/steps.ts). Mọi thứ gated trên `isGuest` — quán thật
// không trả giá cho bookkeeping của tutorial. Món không có trong menu (mẫu đổi tên) thì bỏ qua, chỉ còn hint Tạo đơn.
export function useOrderOnboardingProgress({ isGuest, addressId, products, cart, enterKey }: {
    isGuest: boolean; addressId?: string | null; products: Row[]; cart: CartItem[]; enterKey: string | null
}) {
    // Persisted so it survives navigating to /history. Set directly during render (React's
    // "adjust state from a derived value" pattern); the localStorage write is a separate effect.
    const [orderProgress, setOrderProgress] = useState(() =>
        isGuest && addressId ? readOnboardingState(addressId).orderProgress : DEFAULT_ONBOARDING_STATE.orderProgress
    )
    // Bước 1 xong (PrepPinBar ghi khi lấy đủ hàng) mới bắt đầu sáng món — hook sống, đổi ngay trên POS.
    const prepDone = useOnboardingProgress('prepProgress', { isGuest, addressId }).done
    // Bước cuối (đã nhập kho): CTA đăng ký ở cuối Báo cáo — sáng Nhật ký làm đường quay về (Nhật ký → Báo cáo).
    const finalStep = useOnboardingProgress('restockProgress', { isGuest, addressId }).bought

    const targets = useMemo(
        () => (isGuest ? ORDER.map(n => products.find(p => norm(p.name) === n)?.id).filter((id): id is string => !!id) : []),
        [isGuest, products])
    const pending = targets.filter(id => !cart.some(i => i.productId === id))
    const ready = isGuest && cart.length > 0 && !pending.length

    // enterKey đổi mỗi lần gửi đơn thật.
    const [seenKey, setSeenKey] = useState(enterKey)
    if (enterKey !== seenKey) {
        setSeenKey(enterKey)
        if (isGuest && enterKey) setOrderProgress(prev => ({ ...prev, sent: prev.sent + 1 }))
    }
    if (orderProgress.ready !== ready) setOrderProgress(prev => ({ ...prev, ready }))

    useOnboardingProgressPersist('orderProgress', orderProgress, { isGuest, addressId })

    const selling = isGuest && !!addressId && prepDone && orderProgress.sent < 1
    return {
        hintProductIds: selling ? pending : [],
        showCheckoutHint: selling && ready,
        // Bán xong → sáng Nhật ký (Header), nơi đã có cả ngày bán vừa sinh.
        showHistoryHint: isGuest && !!addressId && ((orderProgress.sent >= 1 && !orderProgress.viewedHistory) || finalStep),
    }
}
