import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { trackGuestOnboardingStage } from '../../../services/onboardingFunnelService'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, ONBOARDING_EVENT } from '../../../utils/onboardingStorage'
import Typewriter from '../Typewriter'
import Collapse from './Collapse'
import { STEPS } from './steps'

// Hướng dẫn "một ngày của quán" — 1 dải IN-FLOW trên đỉnh layout (App.tsx OnboardingLayout đặt
// nó trên <Outlet/>), chiếm chỗ thật nên không đè lên gì và cùng 1 chỗ trên mọi trang — khỏi né
// thanh đáy riêng của từng trang (Tạo đơn, footer tab, FAB). Chỉ 1 câu dẫn, căn giữa, chữ gõ dần — không
// số bước/thanh tiến độ; mỗi việc đã có spotlight ngay trên nút/món cần bấm. Hết các bước → không dải:
// CTA đăng ký nằm cuối Báo cáo (DailyReportPage). Từ bước Nhật ký trở đi chữ dẫn do pageGuide quyết định theo trang.
// onPos: POS chỉ hiện dải ở bước 2 (Bán hàng: "Chạm vào món rồi bấm tạo đơn") và bước Nhật ký — bước 1 pill "Bạn cần chuẩn bị" đã tự sáng. Pill nằm chung hàng với pill bàn.
// checkoutReady (chỉ POS): đã chạm đủ món → dải này nhường chỗ cho dải "Bấm Tạo đơn" nằm ngay trên thanh chốt đơn (POSPage).
export default function OnboardingGuide({ onPos = false, checkoutReady = false, inline = false, hide = false }: { onPos?: boolean; checkoutReady?: boolean; inline?: boolean | 'below'; hide?: boolean }) {
    const { isGuest } = useAuth()
    const { addressId } = useAddress()
    const { pathname } = useLocation()
    const onHistory = pathname.startsWith('/history')

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
    // Chữ dẫn theo trang — nút cần bấm tự sáng. Nhật ký giải thích số liệu; Kết ca nói đây là lúc đếm/đối chiếu tiền.
    // Nhật ký và Kết ca (Đối chiếu): chữ giải thích ở đây; câu cầu nối sang bước sau là GuideTapRow do trang tự dựng.
    // idx 3 vẫn ở /history = lúc bấm mũi tên (viewedReport ghi trước khi chuyển trang): giữ dải, không thì nó biến mất rồi hiện lại ở /report → trang nhảy 40px.
    const onJournal = onHistory && (idx === 2 || idx === 3) && !pathname.endsWith('/expense')
    const onReport = pathname.startsWith('/report') && !pathname.endsWith('/revenue')
    const onInventory = pathname.startsWith('/inventory') && !pathname.startsWith('/inventory/stocking')
    const pageGuide = onJournal ? 'Xem hôm nay bán được bao nhiêu'
        : onReport ? (local.restockProgress.bought && !local.restockProgress.viewedNet ? 'Xem tổng thực chi cuối ngày' : idx === 3 ? 'Nhập tiền mặt và chuyển khoản' : idx === 4 ? 'Đối chiếu chênh lệch với doanh thu' : null)
        : !onInventory ? null
        : idx === 4 ? 'Nhập tồn cà phê cuối kỳ' // không "Sau đó": câu cầu nối ở /report vừa mở đầu bằng nó
        : idx === 5 && !local.inventoryProgress.viewedLoss ? 'Xem hao hụt và ly bấm thiếu' : null
    const gone = (onPos && (idx !== 1 || checkoutReady)) || (onHistory && idx === 1) || !isGuest || !addressId || (idx === -1 && !pageGuide)
    const current = gone || idx === -1 ? undefined : STEPS[idx].items(local).find(i => !i.done)
    const hidden = gone || hide || (current?.hideBar && !pageGuide)
    const label = pageGuide ?? current?.label ?? ''
    // Nhớ câu cuối đã hiện: dải ẩn đi thì thu chiều cao dần (bên dưới) thay vì mất hẳn — khỏi giật trang 40px (vd. xong Kiểm kê → dải biến mất).
    const [lastLabel, setLastLabel] = useState('')
    if (!hidden && label !== lastLabel) setLastLabel(label)
    if (onPos ? !(isGuest && addressId) : hidden && !lastLabel) return null

    // Nền cam nhạt để tách hẳn khỏi header (bg-surface) ngay bên dưới — cùng
    // màu nền với header thì dải bị đọc như 1 phần header và dễ bị lướt qua.
    // max-w-lg mx-auto w-full: cùng bề rộng khung trang (các trang bọc nội dung bằng max-w-lg mx-auto) —
    // màn rộng thì dải không tràn ra ngoài header.
    const bar = `shrink-0 flex items-center gap-2.5 min-h-10 py-1.5 px-4 text-[14px] w-full max-w-lg mx-auto ${onPos ? `flex-1 min-w-0 !w-auto h-10 !min-h-0 !py-0 rounded-[14px]` : inline ? 'rounded-[14px]' : ''}`
    const content = (
        <div className={`${bar} relative bg-primary/15 text-text`}>
            {/* Chữ gõ dần (Typewriter); bản ẩn cùng nội dung giữ chỗ để dải không đổi chiều cao lúc đang gõ. */}
            <span className="flex-1 relative uppercase text-center tracking-wider text-[12px] font-black">
                <span className="invisible line-clamp-2">{lastLabel}</span>
                <span className="absolute inset-0 line-clamp-2"><Typewriter text={lastLabel} /></span>
            </span>
        </div>
    )
    // POS: dải luôn mount (khách), pt-3 (cách thẻ Nhật ký) nằm trong phần bị cắt nên co cùng dải.
    if (onPos) return <Collapse show={!hidden} className="flex-1 min-w-0"><div className="pt-3">{content}</div></Collapse>
    // inline: nằm trong trang (ngay trên thẻ Tổng cộng của Nhật ký), pb-3 nằm trong phần bị cắt. hide: trang ẩn dải khi đã chuyển sang dải khác.
    return <Collapse show={!hidden}>{inline ? <div className={inline === 'below' ? 'pt-3' : 'pb-3'}>{content}</div> : content}</Collapse>
}
