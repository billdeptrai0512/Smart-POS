import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { useProducts } from '../../../contexts/ProductContext'
import { trackGuestOnboardingStage } from '../../../services/onboardingFunnelService'
import { findCoffeeIngredient } from '../../../utils/onboardingHint'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, ONBOARDING_EVENT } from '../../../utils/onboardingStorage'
import { STEPS } from './steps'

// Hướng dẫn "Bắt đầu bán hàng" — 1 dải IN-FLOW trên đỉnh layout (App.jsx OnboardingLayout đặt
// nó trên <Outlet/>), chiếm chỗ thật nên không đè lên gì và cùng 1 chỗ trên mọi trang — khỏi né
// thanh đáy riêng của từng trang (Tạo đơn, footer tab, FAB). Chỉ ghi việc cần làm ngay + tiến độ
// bước hiện tại (x/n); không liệt kê cả checklist vì mỗi việc đã có spotlight nhấp nháy ngay trên
// nút/món cần bấm. Hết 6 bước → dải thành nút đăng ký tài khoản thật (guest data chỉ sống trong
// localStorage).
export default function OnboardingGuide() {
    const { isGuest } = useAuth()
    const { selectedAddress } = useAddress()
    const { ingredientConfigs } = useProducts()
    const addressId = selectedAddress?.id
    // Cấu hình (pack/min_stock/tare_weight) có sẵn trong ingredientConfigs (ProductContext).
    const coffeeConfig = findCoffeeIngredient(ingredientConfigs)

    // Mọi tiến độ nằm trong localStorage — writeOnboardingState phát ONBOARDING_EVENT sau mỗi
    // lần ghi, guide (mount 1 lần ở layout) nghe để đọc lại.
    const read = () => (addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE)
    const [local, setLocal] = useState(read)
    useEffect(() => {
        const sync = () => setLocal(read())
        sync()
        window.addEventListener(ONBOARDING_EVENT, sync)
        return () => window.removeEventListener(ONBOARDING_EVENT, sync)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressId])

    // ctx/idx tính TRƯỚC guard bên dưới vì useEffect phễu cần idx — hook không được nằm sau
    // early-return (Rules of Hooks). Cả 2 đều thuần tính toán, không side effect.
    const ctx = { ...local, coffeeConfig }
    const idx = STEPS.findIndex(s => !s.items(ctx).every(i => i.done))
    // 0 = vào dùng thử nhưng chưa xong phase nào; 1-5 = xong bấy nhiêu phase; 6 = xong hết.
    const stageReached = idx === -1 ? STEPS.length : idx

    // Phễu onboarding cho /admin/dashboard — chỉ gửi khi stageReached ĐỔI (component này
    // re-render liên tục theo local state). Không cần watermark
    // localStorage: RPC đã idempotent bằng GREATEST, gửi lại sau khi refresh trang chỉ làm
    // tươi last_seen_at. Xem onboardingFunnelService.js.
    useEffect(() => {
        if (!isGuest || !addressId) return
        trackGuestOnboardingStage(stageReached)
    }, [stageReached, isGuest, addressId])

    if (!isGuest || !addressId) return null

    // Nền cam nhạt + chip "Bước x/6" để tách hẳn khỏi header (bg-surface) ngay bên dưới — cùng
    // màu nền với header thì dải bị đọc như 1 phần header và dễ bị lướt qua.
    const bar = 'relative shrink-0 flex items-center gap-2.5 h-10 px-4 text-[14px] font-bold'

    if (idx === -1) {
        return (
            <Link
                to="/signup"
                className={`${bar} justify-center bg-primary text-bg uppercase hover:bg-primary/90 active:bg-primary/80 transition-colors`}
            >
                Đăng ký tài khoản
            </Link>
        )
    }

    const items = STEPS[idx].items(ctx)
    const doneCount = items.filter(i => i.done).length
    // Vạch đáy = tiến độ cả 6 bước (bước đang làm tính theo phần item đã xong).
    const overallPct = (idx + doneCount / items.length) / STEPS.length * 100
    return (
        <div className={`${bar} bg-primary/15 text-text`}>
            <span className="shrink-0 rounded-full bg-primary text-bg text-[11px] font-black uppercase px-2 py-0.5 tabular-nums">
                Bước {idx + 1}: {STEPS[idx].title}
            </span>
            <span className="flex-1 truncate">{items.find(i => !i.done)?.label}</span>
            <span className="text-primary tabular-nums shrink-0">{doneCount}/{items.length}</span>
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-primary/20">
                <span className="block h-full bg-primary transition-[width] duration-500" style={{ width: `${overallPct}%` }} />
            </span>
        </div>
    )
}
