import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowRight, ChevronDown, ListChecks } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useProducts } from '../../contexts/ProductContext'
import { fetchIngredientStocks, hasCompletedShiftClosing } from '../../services/orderService'

// v2: đổi key so với bản checklist đầu (tap dòng = tick nhầm) — state cũ coi như bỏ.
const STORAGE_PREFIX = 'onboarding_v2_'
const DEFAULT_STATE = { menuDone: false, collapsed: false }

function readLocalState(addressId) {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + addressId)
        return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE
    } catch { return DEFAULT_STATE }
}
function writeLocalState(addressId, next) {
    try { localStorage.setItem(STORAGE_PREFIX + addressId, JSON.stringify(next)) } catch { /* ignore */ }
}

// Hướng dẫn "Bắt đầu bán hàng" — 2 trạng thái chuyển qua lại, không có nút tắt vĩnh viễn:
//   - Mở rộng: thẻ IN-FLOW dính đáy (trang tự đặt trong khung fixed bottom của nó — trang
//     có FAB thì xếp FAB đứng ngay trên thẻ, khỏi chừa khoảng trống né nhau), chỉ hiện
//     BƯỚC ĐANG LÀM + thanh tiến độ 3 đoạn.
//   - Thu gọn: pill nhỏ tự fixed nép góc trái (FAB chiếm góc phải); bấm bung lại.
// Chỉ biến mất hẳn khi đủ 3 bước. Trạng thái thu/mở + tick bước 1 lưu localStorage theo address.
//
// Hoàn thành: bước 1 bằng tay (chỉ user biết lúc nào menu "đúng thực tế" → link "Đánh dấu
// xong"); bước 2 tự tick khi có ≥1 nguyên liệu nhập tồn kho VÀ ≥1 nhập tồn quầy (tiến độ
// x/N hiện để theo dõi); bước 3 tự tick khi có phiếu chốt ca đầu tiên.
export default function OnboardingGuide() {
    const navigate = useNavigate()
    const location = useLocation()
    const { isManager, isAdmin } = useAuth()
    const { selectedAddress } = useAddress()
    const { ingredientCosts } = useProducts()
    const canEdit = isManager || isAdmin
    const addressId = selectedAddress?.id

    const [local, setLocal] = useState(DEFAULT_STATE)
    const [stockProgress, setStockProgress] = useState({ warehouse: 0, counter: 0 })
    const [closingDone, setClosingDone] = useState(false)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        setLocal(addressId ? readLocalState(addressId) : DEFAULT_STATE)
    }, [addressId])

    const reload = useCallback(() => {
        if (!addressId) return
        Promise.all([
            fetchIngredientStocks(addressId),
            hasCompletedShiftClosing(addressId),
        ]).then(([stocks, closed]) => {
            const byKey = {}
            for (const s of stocks) byKey[s.ingredient] = s
            let warehouse = 0, counter = 0
            for (const key of Object.keys(ingredientCosts || {})) {
                if ((byKey[key]?.warehouse_stock || 0) > 0) warehouse++
                if ((byKey[key]?.counter_stock || 0) > 0) counter++
            }
            setStockProgress({ warehouse, counter })
            setClosingDone(closed)
            setLoaded(true)
        })
    }, [addressId, ingredientCosts])

    useEffect(() => {
        reload()
        const onVis = () => { if (document.visibilityState === 'visible') reload() }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [reload])

    if (!canEdit || !addressId || !loaded) return null

    const total = Object.keys(ingredientCosts || {}).length
    const steps = [
        {
            done: local.menuDone, to: '/recipes', navLabel: 'Đi tới công thức', confirmKey: 'menuDone',
            title: 'Chỉnh menu & công thức',
            subtitle: 'Rà lại món và định lượng đúng quán bạn',
        },
        {
            done: stockProgress.warehouse > 0 && stockProgress.counter > 0,
            to: '/ingredients', navLabel: 'Đi tới nguyên liệu',
            title: 'Nhập tồn kho & tồn quầy',
            subtitle: `Tồn kho ${stockProgress.warehouse}/${total} · Tồn quầy ${stockProgress.counter}/${total} nguyên liệu`,
        },
        {
            done: closingDone, to: '/daily-report', navLabel: 'Đi tới báo cáo',
            title: 'Chốt ca đầu tiên',
            subtitle: 'Cuối buổi bán, đếm tồn quầy một lần — sáng mai không phải đếm gì',
        },
    ]
    const idx = steps.findIndex(s => !s.done)
    if (idx === -1) return null
    const step = steps[idx]
    const doneCount = steps.filter(s => s.done).length

    const save = (patch) => {
        const next = { ...local, ...patch }
        setLocal(next); writeLocalState(addressId, next)
    }

    if (local.collapsed) {
        return (
            <button
                onClick={() => save({ collapsed: false })}
                className="fixed bottom-4 left-4 z-40 pointer-events-auto flex items-center gap-1.5 bg-surface border border-primary/50 rounded-full px-3 py-2 shadow-lg hover:bg-surface-light transition-colors"
                title="Mở hướng dẫn bắt đầu bán hàng"
            >
                <ListChecks size={15} className="text-primary" />
                <span className="text-text font-black text-[12px] tabular-nums">{doneCount}/3</span>
            </button>
        )
    }

    const showNav = location.pathname !== step.to
    return (
        <div className="pointer-events-auto bg-surface border-t border-x border-primary/30 rounded-t-[14px] shadow-2xl p-3 pb-[max(env(safe-area-inset-bottom),12px)]">
            <div className="flex items-center justify-between mb-2">
                <span className="text-primary text-[10px] font-black uppercase tracking-wider">
                    Bắt đầu bán hàng · bước {idx + 1}/3
                </span>
                <button onClick={() => save({ collapsed: true })} className="text-text-dim hover:text-text p-1 -m-1" title="Thu gọn">
                    <ChevronDown size={15} />
                </button>
            </div>
            <div className="flex gap-1 mb-2.5">
                {steps.map((s, i) => (
                    <div key={i} className={`flex-1 h-[3px] rounded-full ${s.done ? 'bg-success' : i === idx ? 'bg-primary' : 'bg-border/60'}`} />
                ))}
            </div>
            <p className="text-text font-black text-[13px] leading-tight">{step.title}</p>
            <p className={`text-text-secondary text-[11px] mt-0.5 ${(showNav || step.confirmKey) ? 'mb-2.5' : ''}`}>{step.subtitle}</p>
            {(showNav || step.confirmKey) && (
                <div className="flex items-center gap-3">
                    {showNav && (
                        <button
                            onClick={() => navigate(step.to)}
                            className="flex-1 flex items-center justify-center gap-1 bg-primary text-bg font-black text-[12px] uppercase rounded-[10px] py-2 hover:bg-primary/90 active:bg-primary/80 transition-colors"
                        >
                            {step.navLabel} <ArrowRight size={13} strokeWidth={3} />
                        </button>
                    )}
                    {step.confirmKey && (
                        <button
                            onClick={() => save({ [step.confirmKey]: true })}
                            className="shrink-0 text-text-secondary text-[11px] font-bold underline underline-offset-2 px-1 py-2 hover:text-text transition-colors"
                        >
                            Đánh dấu xong
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
