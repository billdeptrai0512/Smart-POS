import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CircleHelp } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { useProducts } from '../../../contexts/ProductContext'
import { useOnboardingVisibility } from '../../../contexts/OnboardingVisibilityContext'
import { fetchIngredientStocks } from '../../../services/orderService'
import { findCoffeeIngredient } from '../../../utils/onboardingHint'
import { readOnboardingState, writeOnboardingState, DEFAULT_ONBOARDING_STATE } from '../../../utils/onboardingStorage'
import orderStep from './steps/orderStep'
import journalStep from './steps/journalStep'
import cashReportStep from './steps/cashReportStep'
import inventoryStep from './steps/inventoryStep'
import mainStockStep from './steps/mainStockStep'
import recipeStep from './steps/recipeStep'
import ingredientCoffeeStep from './steps/ingredientCoffeeStep'

// 7 bước, mỗi bước 1 file trong ./steps — mỗi file tự định nghĩa done(ctx), to/state/navLabel,
// và Body (checklist UI riêng). Shell dưới đây chỉ lo fetch data dùng chung + chọn bước active.
const STEPS = [orderStep, journalStep, cashReportStep, inventoryStep, recipeStep, mainStockStep, ingredientCoffeeStep]

// Hiện khi user đã xong cả 7 bước — guide không biến mất nữa, chuyển sang hướng dẫn đăng ký
// tài khoản thật để lưu lại dữ liệu (guest data chỉ sống trong localStorage).
const FINISHED_STEP = {
    to: '/signup',
    navLabel: 'Đăng ký tài khoản',
    name: 'Đăng ký để lưu dữ liệu',
    Body: () => (
        <p className="text-[11px] text-text-secondary">
            Bạn đã hoàn thành hướng dẫn! Đăng ký tài khoản để lưu lại toàn bộ dữ liệu.
        </p>
    ),
}

// Hướng dẫn "Bắt đầu bán hàng" — 2 trạng thái chuyển qua lại, không có nút tắt vĩnh viễn:
//   - Mở rộng: thẻ IN-FLOW dính đáy (trang tự đặt trong khung fixed bottom của nó — trang
//     có FAB thì xếp FAB đứng ngay trên thẻ, khỏi chừa khoảng trống né nhau).
//   - Thu gọn: pill nhỏ tự fixed nép góc trái (FAB chiếm góc phải); bấm bung lại.
// Không còn biến mất khi xong hết — hết 7 bước thì chuyển sang FINISHED_STEP (CTA đăng ký tài
// khoản thật). Trạng thái thu/mở + tick từng bước lưu localStorage theo address.
//
// Hoàn thành: bước 1 tự detect qua orderProgress trong localStorage (xem onboardingStorage.js
// + orderStep.jsx) — 3 việc user làm thật ở /pos + /history, không phải "đơn đã submit" (POS
// 1-tap model khiến "submit" lag 1 tap sau hành động thật). Bước 6 (Tồn kho nguyên liệu) đòi
// đủ 100% checklist con — không còn tách riêng bao bì, gộp chung 1 lượt quét ingredientConfigs.
// Bước 3-4 (báo cáo thực thu/kiểm kê) tick "lỏng" theo kiểu "đã từng làm" (không phải "hôm
// nay") để tránh guide tái xuất hiện khi dữ liệu hôm sau reset. Bước 7 (Nguyên liệu) dùng lại
// đúng field warehouse_stock của bước 6 (chỉ lọc riêng "Cà phê") nên có thể đã done sẵn khi
// user chạm tới — chấp nhận được, guide chỉ lướt qua nhanh chứ không chặn.
export default function OnboardingGuide() {
    const navigate = useNavigate()
    const { isGuest } = useAuth()
    const { selectedAddress } = useAddress()
    const { ingredientConfigs } = useProducts()
    const { bottomOffset, refreshToken } = useOnboardingVisibility()
    const addressId = selectedAddress?.id

    const [local, setLocal] = useState(DEFAULT_ONBOARDING_STATE)
    const [stockProgress, setStockProgress] = useState({
        allWarehouse: 0, allCounter: 0, totalAll: 0, coffeeWarehouseSet: false,
    })
    const [loaded, setLoaded] = useState(false)

    // refreshToken cũng re-read local (không chỉ addressId) — MenuGrid/HistoryPage ghi
    // orderProgress qua writeOnboardingState rồi tự gọi requestRefresh(), đây là cách guide
    // (component khác, mounted 1 lần ở layout level) biết mà đọc lại localStorage.
    useEffect(() => {
        setLocal(addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE)
    }, [addressId, refreshToken])

    const reload = useCallback(() => {
        if (!addressId) return
        fetchIngredientStocks(addressId).then((stocks) => {
            const byKey = {}
            for (const s of stocks) byKey[s.ingredient] = s
            const totalAll = (ingredientConfigs || []).length
            let allWarehouse = 0, allCounter = 0
            for (const c of ingredientConfigs || []) {
                const row = byKey[c.ingredient]
                if (row?.warehouse_stock_set) allWarehouse++
                if (row?.counter_stock_set) allCounter++
            }
            const coffeeConfig = findCoffeeIngredient(ingredientConfigs)
            const coffeeWarehouseSet = coffeeConfig ? (byKey[coffeeConfig.ingredient]?.warehouse_stock_set ?? false) : false
            setStockProgress({ allWarehouse, allCounter, totalAll, coffeeWarehouseSet })
            setLoaded(true)
        }).catch(err => console.error('OnboardingGuide reload error:', err))
    }, [addressId, ingredientConfigs])

    useEffect(() => {
        reload()
        const onVis = () => { if (document.visibilityState === 'visible') reload() }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [reload, refreshToken])

    if (!isGuest || !addressId || !loaded) return null

    const save = (patch) => {
        const next = { ...local, ...patch }
        setLocal(next); writeOnboardingState(addressId, patch)
    }

    const ctx = { ...local, stockProgress }

    const idx = STEPS.findIndex(s => !s.done(ctx))
    const step = idx === -1 ? FINISHED_STEP : STEPS[idx]
    const Body = step.Body

    // 1 khối duy nhất: header (bấm để mở/thu gọn) + nội dung khi mở, thay vì pill + thẻ
    // nổi tách rời trước đây.
    return (
        <div
            className="fixed left-3 z-[60] pointer-events-auto bg-surface border border-primary/30 rounded-[14px] shadow-lg max-w-[280px]"
            style={{ bottom: 16 + bottomOffset }}
        >
            <button
                onClick={() => save({ collapsed: !local.collapsed })}
                className="flex items-center justify-between gap-1.5 px-3 py-2 w-full text-left hover:bg-surface-light rounded-[14px] transition-colors"
                title={local.collapsed ? 'Mở hướng dẫn bắt đầu bán hàng' : 'Thu gọn'}
            >
                <span className="text-text font-black text-[12px] uppercase">{step.name}</span>
                <CircleHelp size={15} className="text-primary shrink-0" />
            </button>
            {!local.collapsed && (
                <div className="px-3 pb-3">
                    {step.navLabel && (
                        <button
                            onClick={() => navigate(step.to, step.state ? { state: step.state } : undefined)}
                            className="flex items-center gap-1 bg-primary text-bg font-black text-[11px] uppercase rounded-[8px] px-2.5 py-1.5 mb-1.5 hover:bg-primary/90 active:bg-primary/80 transition-colors"
                        >
                            {step.navLabel} <ArrowRight size={11} strokeWidth={3} />
                        </button>
                    )}
                    <div className="space-y-1">
                        <Body ctx={ctx} />
                    </div>
                </div>
            )}
        </div>
    )
}
