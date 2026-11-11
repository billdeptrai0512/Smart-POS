import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Hand, Lightbulb } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { trackGuestOnboardingStage } from '../../../services/onboardingFunnelService'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, ONBOARDING_EVENT } from '../../../utils/onboardingStorage'
import Typewriter from '../Typewriter'
import { STEPS } from './steps'

// Hướng dẫn "Bắt đầu bán hàng" — 1 dải IN-FLOW trên đỉnh layout (App.tsx OnboardingLayout đặt
// nó trên <Outlet/>), chiếm chỗ thật nên không đè lên gì và cùng 1 chỗ trên mọi trang — khỏi né
// thanh đáy riêng của từng trang (Tạo đơn, footer tab, FAB). Chỉ ghi việc cần làm ngay + số việc đã xong
// trên tổng (done/total); không liệt kê cả checklist vì mỗi việc đã có spotlight nhấp nháy ngay trên
// nút/món cần bấm. Hết các bước → dải thành nút đăng ký tài khoản thật (guest data chỉ sống trong
// localStorage).
// onPos: POS chỉ hiện dải ở bước 2 (Bán hàng: "KOPHiN xin chào") — bước 1 pill "Bạn cần chuẩn bị" đã tự sáng, từ bước 3 trở đi các nút cần bấm tự sáng. Pill nằm chung hàng với pill bàn (không số bước, không thanh tiến độ).
export default function OnboardingGuide({ onPos = false }: { onPos?: boolean }) {
    const { isGuest } = useAuth()
    const { addressId } = useAddress()
    const onHistory = useLocation().pathname.startsWith('/history')

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

    // idx tính TRƯỚC guard bên dưới vì useEffect phễu cần nó — hook không được nằm sau early-return.
    const idx = STEPS.findIndex(s => !s.items(local).every(i => i.done))
    // 0 = vào dùng thử nhưng chưa xong bước nào; 1..5 = xong bấy nhiêu bước; 6 = xong hết.
    const stageReached = idx === -1 ? STEPS.length : idx

    // Phễu onboarding cho /admin/dashboard — chỉ gửi khi stageReached ĐỔI (component này
    // re-render liên tục theo local state). Không cần watermark
    // localStorage: RPC đã idempotent bằng GREATEST, gửi lại sau khi refresh trang chỉ làm
    // tươi last_seen_at. Xem onboardingFunnelService.ts.
    useEffect(() => {
        if (!isGuest || !addressId) return
        trackGuestOnboardingStage(stageReached)
    }, [stageReached, isGuest, addressId])

    // idx -1 = xong hết: không dải — CTA đăng ký nằm cuối Báo cáo (DailyReportPage), các trang khác sáng đường về đó.
    if ((onPos && idx !== 1) || (onHistory && idx === 1) || !isGuest || !addressId || idx === -1) return null

    // Nền cam nhạt + icon để tách hẳn khỏi header (bg-surface) ngay bên dưới — cùng
    // màu nền với header thì dải bị đọc như 1 phần header và dễ bị lướt qua.
    // max-w-lg mx-auto w-full: cùng bề rộng khung trang (các trang bọc nội dung bằng max-w-lg mx-auto) —
    // màn rộng thì dải không tràn ra ngoài header.
    const bar = `shrink-0 flex items-center gap-2.5 min-h-10 py-1.5 px-4 text-[14px] w-full max-w-lg mx-auto ${onPos ? `flex-1 min-w-0 !w-auto h-10 !min-h-0 !py-0 rounded-[14px]` : ''}`

    const items = STEPS[idx].items(local)
    const flat = STEPS.flatMap(s => s.items(local))
    const offerFrom = flat.findIndex(i => i.offerSignup)
    const showSignup = offerFrom >= 0 && flat.findIndex(i => !i.done) >= offerFrom
    const current = items.find(i => !i.done)
    if (current?.hideBar) return null
    const label = current?.label ?? ''
    return (
        <div className={`${bar} relative bg-primary/15 text-text`}>
            {onPos
                ? <Hand size={18} className="shrink-0 text-primary wave-hand" />
                : <span className="shrink-0 grid place-items-center size-6 rounded-full bg-primary/20 text-primary"><Lightbulb size={14} /></span>}
            {!onPos && <span className="shrink-0 text-[11px] font-black tabular-nums text-primary">{idx + 1}/{STEPS.length}</span>}
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
            {/* Thanh tiến độ mảnh dưới đáy dải: khách thấy còn bao xa. */}
            {!onPos && <span className="absolute bottom-0 left-0 h-0.5 bg-primary transition-all duration-500" style={{ width: `${(idx / STEPS.length) * 100}%` }} />}
        </div>
    )
}
