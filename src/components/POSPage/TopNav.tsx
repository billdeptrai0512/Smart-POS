import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Banknote, Bell, ClipboardCheck, FileText, LayoutGrid, MapPin, Menu, Package, Receipt, ShoppingBag, Tag, TrendingUp, Users, Wallet, X, type LucideIcon } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useHistory } from '../../contexts/HistoryContext'
import { STOCK_CACHE_KEY } from '../../hooks/useRestockOverview'
import { readJSON } from '../../utils/storage'
import AddressNotice from '../AddressSelectPage/AddressNotice'
import ActionPill from '../common/ActionPill'
import { ingredientDetailPath } from '../IngredientManagementPage/DebtSection'
import WarehousePrepNotice from '../IngredientManagementPage/WarehousePrepNotice'
import { Dialog } from '../common/ModalShell'
import AddressSwitcher from './AddressSwitcher'

const ICON_BTN = 'relative shrink-0 w-10 h-10 flex items-center justify-center rounded-[14px] bg-bg border border-border/60 text-text-secondary active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
// Mọi trang của app, nhóm theo khu vực (tab con của mỗi trang là một mục riêng) — khỏi bấm ‹ › lần lượt.
// manager: chỉ quản lý/admin thấy. state: truyền cho trang đích (Nhân viên = tab "staff" của /addresses).
type Item = { icon: LucideIcon; label: string; tone: string; route: string; wide?: boolean; manager?: boolean; noGuest?: boolean; state?: { tab: string } }
const SECTIONS: { title: string; items: Item[] }[] = [
    { title: '', items: [{ icon: MapPin, label: 'Địa chỉ', tone: 'primary', route: '/addresses', noGuest: true }, { icon: ShoppingBag, label: 'Tạo đơn', tone: 'primary', route: '/pos' }] },
    { title: 'Nhật ký', items: [{ icon: Receipt, label: 'Đơn bán', tone: 'primary', route: '/history/sales' }, { icon: Wallet, label: 'Chi phí', tone: 'primary', route: '/history/expense' }] },
    { title: 'Báo cáo', items: [{ icon: Banknote, label: 'Dòng tiền', tone: 'success', route: '/report/cashflow' }, { icon: TrendingUp, label: 'Lợi nhuận', tone: 'success', route: '/report/revenue' }] },
    { title: 'Tồn kho', items: [{ icon: ClipboardCheck, label: 'Kiểm kê', tone: 'primary', route: '/inventory/management' }, { icon: Package, label: 'Lưu trữ', tone: 'primary', route: '/inventory/stocking' }] },
    { title: 'Danh mục', items: [{ icon: LayoutGrid, label: 'Menu', tone: 'primary', route: '/category/overall' }, { icon: FileText, label: 'Công thức', tone: 'primary', route: '/category/recipes' }, { icon: Tag, label: 'Chương trình khuyến mãi', tone: 'warning', route: '/category/discounts', wide: true }] },
    { title: 'Quản lý', items: [{ icon: Users, label: 'Nhân viên', tone: 'primary', route: '/addresses', manager: true, noGuest: true, wide: true, state: { tab: 'staff' } }] },
]

// Số kho còn việc theo bản đã tính gần nhất (cache của "Việc cần làm") — đọc rẻ, không tải gì thêm lúc đang bán.
// Số tươi hơn có khi mở sheet (nó tải nền rồi cập nhật cache).
const pendingCount = () => Object.values(readJSON<Record<string, { need: number }>>(STOCK_CACHE_KEY, {})).filter(s => s.need > 0).length

// Hàng đầu của POS: ô địa chỉ (đổi tại chỗ) · chuông "Việc cần làm" · menu điều hướng.
export default function TopNav() {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { handleLoadHistory } = useHistory()
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { warehouseRole, addresses } = useAddress()
    // Chuông = "việc cần làm" của người dùng, không chia đôi: quản lý nhiều địa chỉ → danh sách việc từng địa chỉ (AddressNotice);
    // còn lại (1 địa chỉ, hoặc nhân viên) → bổ sung tồn kho của địa chỉ đang đứng. Chi nhánh thành viên kho chung không mua hàng → không có chuông.
    const kind = (isManager || isAdmin) && addresses.length > 1 ? 'tasks' : warehouseRole !== 'member' && warehouseRole !== 'pending' ? 'restock' : null
    const [bellOpen, setBellOpen] = useState(false)
    const [showMenu, setShowMenu] = useState(false)
    const [pending, setPending] = useState(pendingCount)

    function go({ route, state }: Item) {
        setShowMenu(false)
        navigate(route, { state })
        if (route.startsWith('/history')) handleLoadHistory()
    }

    return (
        <>
            <AddressSwitcher />
            {!isGuest && kind && (
                <button type="button" aria-label="Việc cần làm" onClick={() => setBellOpen(true)} className={ICON_BTN}>
                    <Bell size={19} />
                    {kind === 'tasks' && pending > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-black flex items-center justify-center leading-none">!</span>
                    )}
                </button>
            )}
            <button type="button" aria-label="Menu" onClick={() => setShowMenu(true)} className={ICON_BTN}>
                <Menu size={20} />
            </button>
            {bellOpen && kind === 'tasks' && <AddressNotice onClose={() => { setBellOpen(false); setPending(pendingCount()) }} />}
            {bellOpen && kind === 'restock' && (
                <WarehousePrepNotice
                    onClose={() => setBellOpen(false)}
                    onOpenIngredient={(ing, tab, since) => { setBellOpen(false); navigate(ingredientDetailPath(ing, tab, since)) }}
                />
            )}
            {showMenu && (
                <Dialog
                    onClose={() => setShowMenu(false)}
                    panelClassName="w-full max-w-sm mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
                >
                    <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                        <p className="text-text font-black text-sm leading-none">Điều hướng</p>
                        <button onClick={() => setShowMenu(false)} aria-label="Đóng" className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all shrink-0">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="overflow-y-auto px-3 pt-3 pb-5 flex flex-col gap-4">
                        {SECTIONS.map(sec => {
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
