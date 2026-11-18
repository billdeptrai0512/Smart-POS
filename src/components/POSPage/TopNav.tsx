import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, Home, Menu, X } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useHistory } from '../../contexts/HistoryContext'
import { useStats } from '../../contexts/StatsContext'
import { STOCK_CACHE_KEY } from '../../hooks/useRestockOverview'
import { readJSON } from '../../utils/storage'
import AddressNotice from '../AddressSelectPage/AddressNotice'
import ActionPill from '../common/ActionPill'
import { ingredientDetailPath } from '../IngredientManagementPage/DebtSection'
import WarehousePrepNotice from '../IngredientManagementPage/WarehousePrepNotice'
import { Dialog } from '../common/ModalShell'
import PrepPinBar from '../common/PrepPinBar'
import AddressSwitcher from './AddressSwitcher'
import { NAV_SECTIONS, type NavItem } from '../../constants/navSections'
import { NAV_ICON_BTN } from '../../constants/navStyles'


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
    const [showMenu, setShowMenu] = useState(false)
    const [pending, setPending] = useState(pendingCount)
    // Chuông theo trang: ở /pos chỉ "Bạn cần chuẩn bị" (hook soạn hàng chỉ được mount 1 chỗ); các trang khác chỉ "Cần bổ sung" (chủ/quản lý).
    const [prepCount, setPrepCount] = useState(0)
    const onPos = pathname === '/pos'
    const { isOnline } = useStats() // offline: PrepPinBar không vẽ gì → đừng cho chuông mở sheet rỗng
    const hasBell = !isGuest && (onPos ? isOnline : !!kind)
    const n = onPos ? prepCount : kind === 'tasks' ? pending : 0

    function go({ route, state }: NavItem) {
        setShowMenu(false)
        navigate(route + carryDateParams(pathname, route, search), { state })
        if (route.startsWith('/history')) handleLoadHistory()
    }

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
            <button type="button" aria-label="Menu" onClick={() => setShowMenu(true)} className={NAV_ICON_BTN}>
                <Menu size={20} />
            </button>
            {onPos && !isGuest && isOnline && <PrepPinBar bell={{ open: bellOpen, onClose: () => setBellOpen(false), onCount: setPrepCount }} />}
            {!onPos && bellOpen && kind === 'tasks' && <AddressNotice onClose={() => { setBellOpen(false); setPending(pendingCount()) }} />}
            {!onPos && bellOpen && kind === 'restock' && (
                <WarehousePrepNotice
                    onClose={() => setBellOpen(false)}
                    onOpenIngredient={(ing, t, since) => { setBellOpen(false); navigate(ingredientDetailPath(ing, t, since)) }}
                />
            )}
            {showMenu && (
                <Dialog
                    onClose={() => setShowMenu(false)}
                    panelClassName="w-full max-w-sm mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
                >
                    <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                        {isGuest ? <span className="w-10 h-10 shrink-0" /> : (
                            <button type="button" aria-label="Về trang địa chỉ" onClick={() => { setShowMenu(false); navigate('/addresses') }} className="w-10 h-10 shrink-0 flex items-center justify-center rounded-[14px] bg-bg border border-border/60 active:bg-border/20 text-success">
                                <Home size={19} />
                            </button>
                        )}
                        <p className="flex-1 text-center text-text font-black text-sm leading-none uppercase tracking-wide">Điều hướng</p>
                        <button onClick={() => setShowMenu(false)} aria-label="Đóng" className="w-10 h-10 shrink-0 flex items-center justify-center rounded-[14px] bg-bg border border-border/60 active:bg-border/20 text-text-secondary">
                            <X size={19} />
                        </button>
                    </div>
                    <div className="overflow-y-auto px-3 pt-3 pb-5 flex flex-col gap-4">
                        {NAV_SECTIONS.map(sec => {
                            const items = sec.items.filter(i => (!i.manager || isManager || isAdmin) && !(i.noGuest && isGuest))
                            return items.length > 0 && (
                                <div key={sec.title}>
                                    {sec.title && <p className="px-1 pb-2 text-[10px] font-black uppercase tracking-wider text-text-secondary">{sec.title}</p>}
                                    <div className="grid grid-cols-2 gap-2">
                                        {items.map(i => (
                                            <ActionPill
                                                key={i.label}
                                                icon={<i.icon size={16} />}
                                                label={i.label}
                                                tone={i.tone}
                                                wide={i.wide}
                                                active={i.route !== '/addresses' && (pathname === i.route || pathname.startsWith(i.route + '/'))}
                                                onClick={() => go(i)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </Dialog>
            )}
        </>
    )
}
