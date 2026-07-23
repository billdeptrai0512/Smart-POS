import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check, ListChecks } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useProducts } from '../../contexts/ProductContext'
import { useOnboardingVisibility } from '../../contexts/OnboardingVisibilityContext'
import { fetchIngredientStocks, hasCompletedShiftClosing, hasCompletedCashReport, fetchTodayShiftClosing } from '../../services/orderService'
import { normalizeIngredientCategory } from '../../utils/ingredients'
import { VIEW_INVENTORY } from '../DailyReportPage/ReportViewFilter'

// v3: bước 1 đổi từ 1 nút "Đánh dấu xong" duy nhất sang checklist tick từng việc — state cũ (menuDone) coi như bỏ.
const STORAGE_PREFIX = 'onboarding_v3_'
const DEFAULT_STATE = { menuChecklist: {}, collapsed: false }
const MENU_CHECKLIST = [
    { key: 'create', label: 'Tạo món mới' },
    { key: 'adjust', label: 'Cài định lượng' },
    { key: 'category', label: 'Tạo mục mới' },
    { key: 'sort', label: 'Sắp xếp menu' },
]

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
//     có FAB thì xếp FAB đứng ngay trên thẻ, khỏi chừa khoảng trống né nhau).
//   - Thu gọn: pill nhỏ tự fixed nép góc trái (FAB chiếm góc phải); bấm bung lại.
// Chỉ biến mất hẳn khi đủ 5 bước. Trạng thái thu/mở + tick bước 1 lưu localStorage theo address.
//
// Hoàn thành: bước 1 bằng tay, user tự tick từng việc trong checklist (menu "đúng thực tế"
// chỉ user biết); bước 2-3 (nguyên liệu/bao bì) đòi đủ 100% checklist con. Bước 4-5 (báo cáo
// thực thu/kiểm kê) tick "lỏng" theo kiểu "đã từng làm" (không phải "hôm nay") để tránh guide
// tái xuất hiện khi dữ liệu hôm sau reset — checklist con của 2 bước này chỉ hiện tiến độ,
// không phải điều kiện qua bước.
export default function OnboardingGuide() {
    const navigate = useNavigate()
    const { isManager, isAdmin } = useAuth()
    const { selectedAddress } = useAddress()
    const { ingredientConfigs } = useProducts()
    const { bottomOffset, refreshToken } = useOnboardingVisibility()
    const canEdit = isManager || isAdmin
    const addressId = selectedAddress?.id

    const [local, setLocal] = useState(DEFAULT_STATE)
    const [stockProgress, setStockProgress] = useState({ mainWarehouse: 0, mainCounter: 0, packagingWarehouse: 0, packagingCounter: 0 })
    const [closingDone, setClosingDone] = useState(false)
    const [cashReportDone, setCashReportDone] = useState({ cash: false, transfer: false })
    const [todayClosing, setTodayClosing] = useState(null)
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        setLocal(addressId ? readLocalState(addressId) : DEFAULT_STATE)
    }, [addressId])

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

    if (!canEdit || !addressId || !loaded) return null

    const save = (patch) => {
        const next = { ...local, ...patch }
        setLocal(next); writeLocalState(addressId, next)
    }
    const toggleChecklistItem = (key) => {
        save({ menuChecklist: { ...local.menuChecklist, [key]: !local.menuChecklist?.[key] } })
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

    const makeStockChecklist = (prefix, total, warehouse, counter) => total > 0 ? [
        { key: `${prefix}Warehouse`, label: `Nhập tồn kho ${warehouse}/${total}`, done: warehouse >= total },
        { key: `${prefix}Counter`, label: `Nhập tồn quầy ${counter}/${total}`, done: counter >= total },
    ] : []
    const mainStockChecklist = makeStockChecklist('main', totalMain, stockProgress.mainWarehouse, stockProgress.mainCounter)
    const packagingStockChecklist = makeStockChecklist('packaging', totalPackaging, stockProgress.packagingWarehouse, stockProgress.packagingCounter)
    const cashChecklist = [
        { key: 'cash', label: 'Nhập tiền mặt', done: todayClosing?.actual_cash != null },
        { key: 'transfer', label: 'Nhập chuyển khoản', done: todayClosing?.actual_transfer != null },
    ]
    const inventoryChecklist = [
        { key: 'inventory', label: `Nhập tồn cuối ${countedToday}/${totalStock}`, done: countedToday >= totalStock },
    ]

    const steps = [
        {
            done: MENU_CHECKLIST.every(item => local.menuChecklist?.[item.key]),
            to: '/recipes', navLabel: 'Đi tới công thức',
            checklist: MENU_CHECKLIST.map(item => ({
                key: item.key, label: item.label, done: !!local.menuChecklist?.[item.key],
                onClick: () => toggleChecklistItem(item.key),
            })),
        },
        {
            done: mainStockChecklist.every(item => item.done),
            to: '/ingredients', state: { viewMode: 'main' }, navLabel: 'Đi tới nguyên liệu',
            checklist: mainStockChecklist,
        },
        {
            done: packagingStockChecklist.every(item => item.done),
            to: '/ingredients', state: { viewMode: 'packaging' }, navLabel: 'Đi tới bao bì',
            checklist: packagingStockChecklist,
        },
        {
            done: cashReportDone.cash && cashReportDone.transfer, to: '/daily-report', navLabel: 'Đi tới báo cáo dòng tiền',
            checklist: cashChecklist,
        },
        {
            done: closingDone, to: '/daily-report', state: { initialView: VIEW_INVENTORY }, navLabel: 'Đi tới báo cáo tồn kho',
            checklist: inventoryChecklist,
        },
    ]
    const idx = steps.findIndex(s => !s.done)
    if (idx === -1) return null
    const step = steps[idx]

    // Pill luôn hiện, làm cả 2 việc: bấm để mở khi đang thu gọn, bấm lại để thu gọn khi
    // thẻ đang mở (thẻ nổi ngay phía trên, có khoảng cách — không cần nút "thu gọn" riêng).
    return (
        <>
            {!local.collapsed && (
                <div
                    className="fixed left-3 z-[60] pointer-events-auto bg-surface border border-primary/30 rounded-[14px] shadow-lg p-3 max-w-[280px]"
                    style={{ bottom: 56 + bottomOffset }}
                >
                    <button
                        onClick={() => navigate(step.to, step.state ? { state: step.state } : undefined)}
                        className="flex items-center gap-1 bg-primary text-bg font-black text-[11px] uppercase rounded-[8px] px-2.5 py-1.5 mb-1.5 hover:bg-primary/90 active:bg-primary/80 transition-colors"
                    >
                        {step.navLabel} <ArrowRight size={11} strokeWidth={3} />
                    </button>
                    <div className="space-y-1">
                        {step.checklist.map(item => {
                            const Row = item.onClick ? 'button' : 'div'
                            return (
                                <Row
                                    key={item.key}
                                    onClick={item.onClick}
                                    className="flex items-center justify-between gap-1.5 text-[11px] w-full text-left"
                                >
                                    <span className={item.done ? 'text-text-dim line-through' : 'text-text-secondary'}>{item.label}</span>
                                    <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border shrink-0 ${item.done ? 'bg-primary border-primary' : 'border-text-dim'}`}>
                                        {item.done && <Check size={10} strokeWidth={3} className="text-bg" />}
                                    </span>
                                </Row>
                            )
                        })}
                    </div>
                </div>
            )}
            <button
                onClick={() => save({ collapsed: !local.collapsed })}
                className="fixed left-4 z-[60] pointer-events-auto flex items-center gap-1.5 bg-surface border border-primary/50 rounded-[10px] px-3 py-2 shadow-lg hover:bg-surface-light transition-colors"
                style={{ bottom: 16 + bottomOffset }}
                title={local.collapsed ? 'Mở hướng dẫn bắt đầu bán hàng' : 'Thu gọn'}
            >
                <ListChecks size={15} className="text-primary" />
                <span className="text-text font-black text-[12px] tabular-nums">{idx + 1}/{steps.length}</span>
            </button>
        </>
    )
}
