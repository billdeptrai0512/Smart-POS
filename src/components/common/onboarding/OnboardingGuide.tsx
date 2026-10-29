import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check, Lightbulb } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { useProducts } from '../../../contexts/ProductContext'
import { trackGuestOnboardingStage } from '../../../services/onboardingFunnelService'
import { sortIngredients } from '../../../utils/ingredients'
import { norm } from '../../../utils/onboardingHint'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, ONBOARDING_EVENT } from '../../../utils/onboardingStorage'
import Typewriter from '../Typewriter'
import { STEPS, RECIPE_TARGET_PRODUCT } from './steps'

// Hướng dẫn "Bắt đầu bán hàng" — 1 dải IN-FLOW trên đỉnh layout (App.tsx OnboardingLayout đặt
// nó trên <Outlet/>), chiếm chỗ thật nên không đè lên gì và cùng 1 chỗ trên mọi trang — khỏi né
// thanh đáy riêng của từng trang (Tạo đơn, footer tab, FAB). Chỉ ghi việc cần làm ngay + số việc đã xong
// trên tổng (done/total); không liệt kê cả checklist vì mỗi việc đã có spotlight nhấp nháy ngay trên
// nút/món cần bấm. Hết 5 bước → dải thành nút đăng ký tài khoản thật (guest data chỉ sống trong
// localStorage).
export default function OnboardingGuide() {
    const { isGuest } = useAuth()
    const { addressId, selectedAddress } = useAddress()
    const { products, recipes } = useProducts()

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
    // Dòng định lượng của công thức mục tiêu — cùng thứ tự với trang chi tiết công thức để việc đầu
    // tiên chưa xong khớp đúng ô đang nhấp nháy.
    const recipeRows = useMemo(() => {
        const target = products.find(p => norm(p.name) === RECIPE_TARGET_PRODUCT)
        if (!target) return []
        return recipes
            .filter(r => r.product_id === target.id)
            .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order))
            .map(r => ({ ingredient: r.ingredient, amount: r.amount }))
    }, [products, recipes, selectedAddress?.ingredient_sort_order])
    const ctx = { ...local, recipeRows }
    const idx = STEPS.findIndex(s => !s.items(ctx).every(i => i.done))
    // 0 = vào dùng thử nhưng chưa xong phase nào; 1-4 = xong bấy nhiêu phase; 5 = xong hết.
    const stageReached = idx === -1 ? STEPS.length : idx

    // Phễu onboarding cho /admin/dashboard — chỉ gửi khi stageReached ĐỔI (component này
    // re-render liên tục theo local state). Không cần watermark
    // localStorage: RPC đã idempotent bằng GREATEST, gửi lại sau khi refresh trang chỉ làm
    // tươi last_seen_at. Xem onboardingFunnelService.ts.
    useEffect(() => {
        if (!isGuest || !addressId) return
        trackGuestOnboardingStage(stageReached)
    }, [stageReached, isGuest, addressId])

    if (!isGuest || !addressId) return null

    // Nền cam nhạt + icon để tách hẳn khỏi header (bg-surface) ngay bên dưới — cùng
    // màu nền với header thì dải bị đọc như 1 phần header và dễ bị lướt qua.
    // max-w-lg mx-auto w-full: cùng bề rộng khung trang (các trang bọc nội dung bằng max-w-lg mx-auto) —
    // màn rộng thì dải không tràn ra ngoài header.
    const bar = 'shrink-0 flex items-center gap-2.5 min-h-10 py-1.5 px-4 text-[14px] w-full max-w-lg mx-auto'

    if (idx === -1) {
        return (
            // Cùng kiểu dải nhạt như các việc trước (không phải nền cam đặc — chói); cả dải bấm được.
            <Link
                to="/signup"
                className={`${bar} bg-primary/15 text-primary hover:bg-primary/25 active:bg-primary/30 transition-colors`}
            >
                <span className="shrink-0 grid place-items-center size-6 rounded-full bg-primary/20"><Check size={14} /></span>
                {/* Căn giữa: bản ẩn giữ đủ bề rộng chữ, bản gõ dần chồng lên canh trái — chữ mọc từ trái sang
                    phải thay vì lan ra hai bên. Ô trống size-6 bên phải cân với icon để chữ nằm giữa dải. */}
                <span className="flex-1 text-center uppercase tracking-wider text-[12px] font-black">
                    <span className="relative inline-block">
                        <span className="invisible">Hoàn thành! Đăng ký tài khoản</span>
                        <span className="absolute inset-0 text-left"><Typewriter text="Hoàn thành! Đăng ký tài khoản" /></span>
                    </span>
                </span>
                <span className="shrink-0 size-6" />
            </Link>
        )
    }

    const items = STEPS[idx].items(ctx)
    const flat = STEPS.flatMap(s => s.items(ctx))
    const offerFrom = flat.findIndex(i => i.offerSignup)
    const showSignup = offerFrom >= 0 && flat.findIndex(i => !i.done) >= offerFrom
    const label = items.find(i => !i.done)?.label ?? ''
    return (
        <div className={`${bar} bg-primary/15 text-text`}>
            <span className="shrink-0 grid place-items-center size-6 rounded-full bg-primary/20 text-primary"><Lightbulb size={14} /></span>
            {/* Chữ gõ dần (Typewriter); bản ẩn cùng nội dung giữ chỗ để dải không đổi chiều cao lúc đang gõ. */}
            <span className="flex-1 relative uppercase tracking-wider text-[12px] font-black">
                <span className="invisible line-clamp-2">{label}</span>
                <span className="absolute inset-0 line-clamp-2"><Typewriter text={label} /></span>
            </span>
            {/* Tới việc có cờ offerSignup (steps.ts) thì cho đăng ký sớm — guide vẫn chạy tiếp. */}
            {showSignup && (
                <Link to="/signup" className="shrink-0 text-[12px] font-black uppercase tracking-wider text-primary border border-primary/60 rounded-full px-3 py-0.5 active:bg-primary/15 transition-colors">
                    Đăng ký
                </Link>
            )}
        </div>
    )
}
