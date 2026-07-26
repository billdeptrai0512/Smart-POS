import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CircleHelp } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useAddress } from '../../../contexts/AddressContext'
import { useProducts } from '../../../contexts/ProductContext'
import { useOnboardingVisibility } from '../../../contexts/OnboardingVisibilityContext'
import { fetchIngredientStocks, hasCompletedShiftClosing, hasCompletedCashReport, fetchTodayShiftClosing } from '../../../services/orderService'
import { normalizeIngredientCategory } from '../../../utils/ingredients'
import { readOnboardingState, writeOnboardingState, DEFAULT_ONBOARDING_STATE } from '../../../utils/onboardingStorage'
import orderStep from './steps/orderStep'
import journalStep from './steps/journalStep'
import reportOverviewStep from './steps/reportOverviewStep'
import mainStockStep from './steps/mainStockStep'
import packagingStockStep from './steps/packagingStockStep'
import cashReportStep from './steps/cashReportStep'
import inventoryStep from './steps/inventoryStep'

// 7 bước, mỗi bước 1 file trong ./steps — mỗi file tự định nghĩa done(ctx), to/state/navLabel,
// và Body (checklist UI riêng). Shell dưới đây chỉ lo fetch data dùng chung + chọn bước active.
// reportOverviewStep (phase 3) hiện là placeholder done()=false — xem file đó.
const STEPS = [orderStep, journalStep, reportOverviewStep, mainStockStep, packagingStockStep, cashReportStep, inventoryStep]

// Hướng dẫn "Bắt đầu bán hàng" — 2 trạng thái chuyển qua lại, không có nút tắt vĩnh viễn:
//   - Mở rộng: thẻ IN-FLOW dính đáy (trang tự đặt trong khung fixed bottom của nó — trang
//     có FAB thì xếp FAB đứng ngay trên thẻ, khỏi chừa khoảng trống né nhau).
//   - Thu gọn: pill nhỏ tự fixed nép góc trái (FAB chiếm góc phải); bấm bung lại.
// Chỉ biến mất hẳn khi đủ 5 bước. Trạng thái thu/mở + tick bước 1 lưu localStorage theo address.
//
// Hoàn thành: bước 1 tự detect qua orderProgress trong localStorage (xem onboardingStorage.js
// + orderStep.jsx) — 3 việc user làm thật ở /pos + /history, không phải "đơn đã submit" (POS
// 1-tap model khiến "submit" lag 1 tap sau hành động thật). Bước 2-3 (nguyên liệu/bao bì) đòi
// đủ 100% checklist con. Bước 4-5 (báo cáo thực thu/kiểm kê) tick "lỏng" theo kiểu "đã từng
// làm" (không phải "hôm nay") để tránh guide tái xuất hiện khi dữ liệu hôm sau reset —
// checklist con của 2 bước này chỉ hiện tiến độ, không phải điều kiện qua bước.
export default function OnboardingGuide() {
    const navigate = useNavigate()
    const { isGuest } = useAuth()
    const { selectedAddress } = useAddress()
    const { ingredientConfigs } = useProducts()
    const { bottomOffset, refreshToken } = useOnboardingVisibility()
    const addressId = selectedAddress?.id

    const [local, setLocal] = useState(DEFAULT_ONBOARDING_STATE)
    const [stockProgress, setStockProgress] = useState({ mainWarehouse: 0, mainCounter: 0, packagingWarehouse: 0, packagingCounter: 0 })
    const [closingDone, setClosingDone] = useState(false)
    const [cashReportDone, setCashReportDone] = useState({ cash: false, transfer: false })
    const [todayClosing, setTodayClosing] = useState(null)
    const [loaded, setLoaded] = useState(false)

    // refreshToken cũng re-read local (không chỉ addressId) — MenuGrid/HistoryPage ghi
    // orderProgress qua writeOnboardingState rồi tự gọi requestRefresh(), đây là cách guide
    // (component khác, mounted 1 lần ở layout level) biết mà đọc lại localStorage.
    useEffect(() => {
        setLocal(addressId ? readOnboardingState(addressId) : DEFAULT_ONBOARDING_STATE)
    }, [addressId, refreshToken])

    const reload = useCallback(() => {
        if (!addressId) return
        const ingredientKeys = (ingredientConfigs || []).map(c => c.ingredient)
        Promise.all([
            fetchIngredientStocks(addressId),
            hasCompletedShiftClosing(addressId, ingredientKeys),
            hasCompletedCashReport(addressId),
            fetchTodayShiftClosing(addressId),
        ]).then(([stocks, closed, cashDone, today]) => {
            const byKey = {}
            for (const s of stocks) byKey[s.ingredient] = s
            let mainWarehouse = 0, mainCounter = 0, packagingWarehouse = 0, packagingCounter = 0
            for (const c of ingredientConfigs || []) {
                const isPackaging = normalizeIngredientCategory(c.category) === 'packaging'
                const row = byKey[c.ingredient]
                const hasWarehouse = row?.warehouse_stock_set ?? false
                const hasCounter = row?.counter_stock_set ?? false
                if (isPackaging) {
                    if (hasWarehouse) packagingWarehouse++
                    if (hasCounter) packagingCounter++
                } else {
                    if (hasWarehouse) mainWarehouse++
                    if (hasCounter) mainCounter++
                }
            }
            setStockProgress({ mainWarehouse, mainCounter, packagingWarehouse, packagingCounter })
            setClosingDone(closed)
            setCashReportDone(cashDone)
            setTodayClosing(today)
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

    let totalMain = 0, totalPackaging = 0
    for (const c of ingredientConfigs || []) {
        if (normalizeIngredientCategory(c.category) === 'packaging') totalPackaging++
        else totalMain++
    }
    const totalStock = totalMain + totalPackaging
    const countedToday = Array.isArray(todayClosing?.inventory_report)
        ? todayClosing.inventory_report.filter(item => item?.remaining != null).length
        : 0

    const ctx = {
        orderProgress: local.orderProgress,
        journalProgress: local.journalProgress,
        stockProgress, totalMain, totalPackaging, totalStock,
        todayClosing, countedToday, cashReportDone, closingDone,
    }

    const idx = STEPS.findIndex(s => !s.done(ctx))
    if (idx === -1) return null
    const step = STEPS[idx]
    const Body = step.Body

    // Pill luôn hiện, làm cả 2 việc: bấm để mở khi đang thu gọn, bấm lại để thu gọn khi
    // thẻ đang mở (thẻ nổi ngay phía trên, có khoảng cách — không cần nút "thu gọn" riêng).
    return (
        <>
            {!local.collapsed && (
                <div
                    className="fixed left-3 z-[60] pointer-events-auto bg-surface border border-primary/30 rounded-[14px] shadow-lg p-3 max-w-[280px]"
                    style={{ bottom: 56 + bottomOffset }}
                >
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
            <button
                onClick={() => save({ collapsed: !local.collapsed })}
                className="fixed left-4 z-[60] pointer-events-auto flex items-center gap-1.5 bg-surface border border-primary/50 rounded-[10px] px-3 py-2 shadow-lg hover:bg-surface-light transition-colors"
                style={{ bottom: 16 + bottomOffset }}
                title={local.collapsed ? 'Mở hướng dẫn bắt đầu bán hàng' : 'Thu gọn'}
            >
                <CircleHelp size={15} className="text-primary" />
                <span className="text-text font-black text-[12px]">{step.name}</span>
            </button>
        </>
    )
}
