import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ListChecks } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { useProducts } from '../../../contexts/ProductContext'
import { useOnboardingVisibility } from '../../../contexts/OnboardingVisibilityContext'
import { fetchIngredientStocks } from '../../../services/orderService'
import { trackGuestOnboardingStage } from '../../../services/onboardingFunnelService'
import { findCoffeeIngredient } from '../../../utils/onboardingHint'
import { readOnboardingState, writeOnboardingState, DEFAULT_ONBOARDING_STATE } from '../../../utils/onboardingStorage'
import { onTabReturn } from '../../../utils/tabVisibility'
import orderStep from './steps/orderStep'
import journalStep from './steps/journalStep'
import cashReportStep from './steps/cashReportStep'
import inventoryStep from './steps/inventoryStep'
import recipeStep from './steps/recipeStep'
import ingredientSetupStep from './steps/ingredientSetupStep'

// 6 bước, mỗi bước 1 file trong ./steps — mỗi file tự định nghĩa done(ctx), to/state/navLabel,
// và Body (checklist UI riêng). Shell dưới đây chỉ lo fetch data dùng chung + chọn bước active.
// ⚠ Thêm/bớt bước ở đây → phải sửa 20260801_guest_onboarding_funnel.sql (CHECK 0..6,
// generate_series(0,6), CASE nhãn) rồi chạy lại. Không sửa thì stage vượt 6 bị RPC bỏ qua
// IM LẶNG — phễu chết mà không báo lỗi gì.
const STEPS = [orderStep, journalStep, cashReportStep, inventoryStep, recipeStep, ingredientSetupStep]

// Hiện khi user đã xong cả 6 bước — guide không biến mất nữa, chuyển sang hướng dẫn đăng ký
// tài khoản thật để lưu lại dữ liệu (guest data chỉ sống trong localStorage).
// Không có name/Body: chỉ còn đúng nút CTA, khỏi header + mô tả thừa.
const FINISHED_STEP = {
    to: '/signup',
    navLabel: 'Đăng ký tài khoản',
}

// Hướng dẫn "Bắt đầu bán hàng" — 2 trạng thái chuyển qua lại, không có nút tắt vĩnh viễn:
//   - Mở rộng: thẻ IN-FLOW dính đáy (trang tự đặt trong khung fixed bottom của nó — trang
//     có FAB thì xếp FAB đứng ngay trên thẻ, khỏi chừa khoảng trống né nhau).
//   - Thu gọn: pill nhỏ tự fixed nép góc trái (FAB chiếm góc phải); bấm bung lại.
// Không còn biến mất khi xong hết — hết 6 bước thì chuyển sang FINISHED_STEP (CTA đăng ký tài
// khoản thật). Trạng thái thu/mở + tick từng bước lưu localStorage theo address.
//
// Hoàn thành: bước 1 tự detect qua orderProgress trong localStorage (xem onboardingStorage.js
// + orderStep.jsx) — 3 việc user làm thật ở /pos + /history, không phải "đơn đã submit" (POS
// 1-tap model khiến "submit" lag 1 tap sau hành động thật). Bước 3-4 (báo cáo thực thu/kiểm kê)
// tick "lỏng" theo kiểu "đã từng làm" (không phải "hôm nay") để tránh guide tái xuất hiện khi
// dữ liệu hôm sau reset. Bước 6 (Cài đặt nguyên liệu, CUỐI CÙNG) không còn đòi nhập kho toàn bộ
// nguyên liệu — chỉ đi sâu 1 ingredient mẫu (Cà phê): tồn kho cuối ngày + quy đổi + tồn kho tối
// thiểu + khối lượng bì (xem ingredientSetupStep.jsx).
export default function OnboardingGuide() {
    const navigate = useNavigate()
    const { isGuest } = useAuth()
    const { selectedAddress } = useAddress()
    const { ingredientConfigs } = useProducts()
    const { bottomOffset, refreshToken } = useOnboardingVisibility()
    const addressId = selectedAddress?.id

    const [local, setLocal] = useState(DEFAULT_ONBOARDING_STATE)
    const [stockProgress, setStockProgress] = useState({ coffeeWarehouseSet: false })
    const [loaded, setLoaded] = useState(false)
    // Cấu hình (pack/min_stock/tare_weight) đã có sẵn trong ingredientConfigs (ProductContext),
    // không cần fetch riêng như warehouse_stock_set — chỉ warehouse_stock_set mới cần RPC.
    const coffeeConfig = findCoffeeIngredient(ingredientConfigs)

    // refreshToken cũng re-read local (không chỉ addressId) — MenuGrid/HistoryPage ghi
    // orderProgress qua writeOnboardingState rồi tự gọi requestRefresh(), đây là cách guide
    // (component khác, mounted 1 lần ở layout level) biết mà đọc lại localStorage.
    useEffect(() => {
        setLocal(addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE)
    }, [addressId, refreshToken])

    const reload = useCallback(() => {
        // !isGuest: guide render null cho tài khoản thật (xem guard dưới) — fetch stocks
        // cho họ là request thuần lãng phí, lặp lại mỗi lần tab visible.
        if (!addressId || !isGuest) return
        fetchIngredientStocks(addressId).then((stocks) => {
            const coffeeStock = coffeeConfig ? stocks.find(s => s.ingredient === coffeeConfig.ingredient) : null
            setStockProgress({ coffeeWarehouseSet: coffeeStock?.warehouse_stock_set ?? false })
            setLoaded(true)
        }).catch(err => console.error('OnboardingGuide reload error:', err))
    }, [addressId, isGuest, coffeeConfig])

    useEffect(() => {
        reload()
        // Chỉ khi tab quay lại sau khi đi vắng, không phải mỗi lần visible — xem onTabReturn.
        return onTabReturn(reload)
    }, [reload, refreshToken])

    // ctx/idx tính TRƯỚC guard bên dưới vì useEffect phễu cần idx — hook không được nằm sau
    // early-return (Rules of Hooks). Cả 2 đều thuần tính toán, không side effect.
    const ctx = { ...local, stockProgress, coffeeConfig }
    const idx = STEPS.findIndex(s => !s.done(ctx))
    // 0 = vào dùng thử nhưng chưa xong phase nào; 1-5 = xong bấy nhiêu phase; 6 = xong hết.
    const stageReached = idx === -1 ? STEPS.length : idx

    // Phễu onboarding cho /admin/dashboard — chỉ gửi khi stageReached ĐỔI (component này
    // re-render liên tục: refreshToken, reload(), local state). Không cần watermark
    // localStorage: RPC đã idempotent bằng GREATEST, gửi lại sau khi refresh trang chỉ làm
    // tươi last_seen_at. Xem onboardingFunnelService.js.
    useEffect(() => {
        if (!isGuest || !addressId || !loaded) return
        trackGuestOnboardingStage(stageReached)
    }, [stageReached, isGuest, addressId, loaded])

    if (!isGuest || !addressId || !loaded) return null

    const save = (patch) => {
        const next = { ...local, ...patch }
        setLocal(next); writeOnboardingState(addressId, patch)
    }

    const step = idx === -1 ? FINISHED_STEP : STEPS[idx]
    const Body = step.Body
    // Phase cuối không có name → không render header, nên cũng không thu gọn được (nếu không
    // ép mở, thẻ đang thu gọn sẽ thành rỗng hoàn toàn). Còn đúng 1 nút CTA đăng ký.
    const collapsed = !!step.name && local.collapsed

    // 1 khối duy nhất: header (bấm để mở/thu gọn) + nội dung khi mở, thay vì pill + thẻ
    // nổi tách rời trước đây.
    return (
        <div
            // ponytail: phóng to 25% bằng 1 transform thay vì nhân tay ~20 giá trị
            // px/text-size rải khắp thẻ và các Body con. transform-origin bottom-left
            // giữ nguyên điểm neo góc dưới-trái nên không phải tính lại bottomOffset.
            // Trần: transform không nong layout box, nên bề ngang phải tự chặn —
            // max-w theo vw để 1.25× vẫn lọt màn 360px.
            className="fixed left-3 z-[60] pointer-events-auto bg-surface border border-primary/30 rounded-[14px] shadow-lg max-w-[min(280px,72vw)]"
            style={{ bottom: 16 + bottomOffset, transform: 'scale(1.25)', transformOrigin: 'bottom left' }}
        >
            {step.name && (
                <button
                    onClick={() => save({ collapsed: !local.collapsed })}
                    className="flex items-center justify-between gap-1.5 px-3 py-2 w-full text-left hover:bg-surface-light rounded-[14px] transition-colors"
                    title={local.collapsed ? 'Mở hướng dẫn bắt đầu bán hàng' : 'Thu gọn'}
                >
                    {/* 11px × 1.25 = 13.75px — vẫn to hơn trước (12px) nhưng không vượt
                        chữ ngày 14px trên header POS. */}
                    <span className="text-text font-black text-[11px] uppercase">{step.name}</span>
                    <ListChecks size={15} className="text-primary shrink-0" />
                </button>
            )}
            {!collapsed && (
                <div className={step.name ? 'px-3 pb-3' : 'p-3'}>
                    {step.navLabel && (
                        <button
                            onClick={() => navigate(step.to, step.state ? { state: step.state } : undefined)}
                            className={`flex items-center gap-1 bg-primary text-bg font-black text-[11px] uppercase rounded-[8px] px-2.5 py-1.5 hover:bg-primary/90 active:bg-primary/80 transition-colors ${Body ? 'mb-1.5' : ''}`}
                        >
                            {step.navLabel}
                        </button>
                    )}
                    {Body && (
                        <div className="space-y-1">
                            <Body ctx={ctx} />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
