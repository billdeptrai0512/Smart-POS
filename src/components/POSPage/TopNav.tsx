import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, Menu, X } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useStats } from '../../contexts/StatsContext'
import { STOCK_CACHE_KEY } from '../../hooks/useRestockOverview'
import { readJSON } from '../../utils/storage'
import AddressNotice from '../AddressSelectPage/AddressNotice'
import { ingredientDetailPath } from '../IngredientManagementPage/DebtSection'
import WarehousePrepNotice from '../IngredientManagementPage/WarehousePrepNotice'
import PrepPinBar from '../common/PrepPinBar'
import AddressSwitcher from './AddressSwitcher'
import { NAV_SECTIONS, type NavItem } from '../../constants/navSections'
import { NAV_ICON_BTN, PILL_TONES } from '../../constants/navStyles'


// Số kho còn việc theo bản đã tính gần nhất (cache của "Việc cần làm") — đọc rẻ, không tải gì thêm lúc đang bán.
// Số tươi hơn có khi mở sheet (nó tải nền rồi cập nhật cache).
const pendingCount = () => Object.values(readJSON<Record<string, { need: number }>>(STOCK_CACHE_KEY, {})).filter(s => s.need > 0).length

// Nhật ký ↔ Báo cáo dùng chung khoảng ngày (useDateScope ghi nó trên URL): đi giữa hai trang này qua menu thì mang theo, khỏi về lại hôm nay.
const DATED = /^\/(history|report)(\/|$)/
const DATE_KEYS = ['scope', 'offset', 'start', 'end']
function carryDateParams(from: string, to: string, search: string) {
    if (!DATED.test(from) || !DATED.test(to)) return ''
    const src = new URLSearchParams(search)
    const out = new URLSearchParams()
    DATE_KEYS.forEach(k => { const v = src.get(k); if (v !== null) out.set(k, v) })
    const q = out.toString() // không dùng .size: Safari cũ chưa có
    return q ? `?${q}` : ''
}

// Hàng đầu của POS: ô địa chỉ (đổi tại chỗ) · chuông "Việc cần làm" · menu điều hướng.
export default function TopNav() {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { handleLoadHistory } = useHistory()
    const navigate = useNavigate()
    const { pathname, search } = useLocation()
    const { warehouseRole, addresses } = useAddress()
    // Chuông = "việc cần làm" của người dùng, không chia đôi: quản lý nhiều địa chỉ → danh sách việc từng địa chỉ (AddressNotice);
    // còn lại (1 địa chỉ, hoặc nhân viên) → bổ sung tồn kho của địa chỉ đang đứng. Chi nhánh thành viên kho chung không mua hàng → không có chuông.
    const isOwner = isManager || isAdmin
    const kind = isOwner && addresses.length > 1 ? 'tasks' : isOwner && warehouseRole !== 'member' && warehouseRole !== 'pending' ? 'restock' : null
    const [bellOpen, setBellOpen] = useState(false)
    const [pending, setPending] = useState(pendingCount)
    // Chuông theo trang: ở /pos chỉ "Bạn cần chuẩn bị" (hook soạn hàng chỉ được mount 1 chỗ); các trang khác chỉ "Cần bổ sung" (chủ/quản lý).
    const [prepCount, setPrepCount] = useState(0)
    const onPos = pathname === '/pos'
    // Menu gắn với trang nó được mở: đổi trang (kể cả nút Back của trình duyệt) là tự đóng, không cần effect.
    const [menuPath, setMenuPath] = useState<string | null>(null)
    const showMenu = menuPath === pathname
    const setShowMenu = (open: boolean) => setMenuPath(open ? pathname : null)
    useEffect(() => {
        if (!showMenu) return
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPath(null) }
        window.addEventListener('keydown', esc)
        return () => window.removeEventListener('keydown', esc)
    }, [showMenu])
    const { isOnline } = useStats() // offline: PrepPinBar không vẽ gì → đừng cho chuông mở sheet rỗng
    const hasBell = !isGuest && (onPos ? isOnline : !!kind)
    const n = onPos ? prepCount : kind === 'tasks' ? pending : 0

    function go({ route, state }: NavItem) {
        setShowMenu(false)
        navigate(route + carryDateParams(pathname, route, search), { state })
        if (route.startsWith('/history')) handleLoadHistory()
    }

    const isActive = (i: NavItem) => i.route !== '/addresses' && (pathname === i.route || pathname.startsWith(i.route + '/'))
    // Nhóm hàng = từng section của NAV_SECTIONS (bỏ nhóm rỗng); giữa các nhóm là đường kẻ mảnh.
    const groups = NAV_SECTIONS
        .map(sec => sec.items.filter(i => (!i.manager || isManager || isAdmin) && !(i.noGuest && isGuest)))
        .filter(g => g.length > 0)

    return (
        <>
            <AddressSwitcher />
            {hasBell && (
                <button type="button" aria-label="Việc cần làm" onClick={() => setBellOpen(true)} className={NAV_ICON_BTN}>
                    <Bell size={19} className={n > 0 ? 'text-primary' : ''} />
                    {/* 1 chữ số: ô vuông 20×20 → tròn hẳn; ≥2 chữ số: giãn ngang thành viên thuốc */}
                    {n > 0 && (
                        <span className={`absolute -top-1.5 -right-1.5 h-5 ${n > 9 ? 'px-1.5' : 'w-5 pl-px'} rounded-full bg-primary text-white text-[11px] font-black flex items-center justify-center leading-none pt-px tabular-nums ring-2 ring-surface`}>{n}</span>
                    )}
                </button>
            )}
            <div className="relative shrink-0">
                <button type="button" aria-label="Menu" aria-expanded={showMenu} onClick={() => setShowMenu(!showMenu)} className={NAV_ICON_BTN}>
                    {showMenu ? <X size={20} /> : <Menu size={20} />}
                </button>
                {showMenu && (<>
                    {/* Nền trong suốt: bấm ra ngoài là đóng */}
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <nav className="absolute right-0 top-full mt-2 z-50 w-48 max-h-[calc(100dvh-5rem)] overflow-y-auto p-1.5 bg-surface border border-border/60 rounded-[16px] shadow-2xl flex flex-col">
                        {groups.map((g, gi) => (
                            <div key={gi} className={gi > 0 ? 'mt-1 pt-1 border-t border-border/40' : ''}>
                            {g.map(i => (
                            <button
                                key={i.label}
                                onClick={() => go(i)}
                                className={`relative flex w-full items-center gap-3 px-2.5 py-2.5 rounded-[12px] text-left active:bg-border/30 hover:bg-border/20 transition-colors ${isActive(i) ? 'bg-border/20' : ''}`}
                            >
                                {isActive(i) && <span className="absolute left-0 inset-y-2.5 w-[3px] rounded-full bg-primary" />}
                                <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${PILL_TONES[i.tone]}`}><i.icon size={16} /></span>
                                <span className="text-[12px] font-bold uppercase tracking-wider leading-tight text-text">{i.label}</span>
                            </button>
                            ))}
                            </div>
                        ))}
                    </nav>
                </>)}
            </div>
            {onPos && !isGuest && isOnline && <PrepPinBar bell={{ open: bellOpen, onClose: () => setBellOpen(false), onCount: setPrepCount }} />}
            {!onPos && bellOpen && kind === 'tasks' && <AddressNotice onClose={() => { setBellOpen(false); setPending(pendingCount()) }} />}
            {!onPos && bellOpen && kind === 'restock' && (
                <WarehousePrepNotice
                    onClose={() => setBellOpen(false)}
                    onOpenIngredient={(ing, t, since) => { setBellOpen(false); navigate(ingredientDetailPath(ing, t, since)) }}
                />
            )}
        </>
    )
}
