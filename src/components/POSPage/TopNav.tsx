import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Banknote, Bell, ChevronRight, ClipboardCheck, ClipboardList, FileText, LayoutGrid, MapPin, Menu, Package, Receipt, ShoppingBag, Tag, TrendingUp, Users, Wallet, X, type LucideIcon } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useHistory } from '../../contexts/HistoryContext'
import { STOCK_CACHE_KEY } from '../../hooks/useRestockOverview'
import { readJSON } from '../../utils/storage'
import AddressNotice, { StockLoader } from '../AddressSelectPage/AddressNotice'
import ActionPill from '../common/ActionPill'
import WarehousePrepNotice from '../IngredientManagementPage/WarehousePrepNotice'
import { BottomSheet, Dialog, SheetHeader, SHEET_PANEL } from '../common/ModalShell'
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

function BellRow({ icon: Icon, label, note, count, onClick }: { icon: LucideIcon; label: string; note: string; count?: number; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="flex items-center gap-3 px-3 py-3 rounded-[14px] bg-bg border border-border/60 text-left active:scale-[0.99] transition-all">
            <Icon size={18} className="shrink-0 text-primary" />
            <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-black text-text">{label}</span>
                <span className="block text-[12px] font-bold text-text-secondary">{note}</span>
            </span>
            {!!count && <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-white text-[11px] font-black flex items-center justify-center">{count}</span>}
            <ChevronRight size={16} className="shrink-0 text-text-dim" />
        </button>
    )
}

// Hàng đầu của POS: ô địa chỉ (đổi tại chỗ) · chuông "Việc cần làm" · menu điều hướng.
export default function TopNav() {
    const { isGuest, isManager, isAdmin } = useAuth()
    const { handleLoadHistory } = useHistory()
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const { warehouseRole, selectedAddress, addresses, addressId } = useAddress()
    const current = addresses.find(a => a.id === addressId)
    // Số việc bổ sung của địa chỉ đang đứng: tính khi mở sheet (~5 request), không tính sẵn lúc vào trang. Kho tổng (hub) tính gộp nhóm → không hiện số.
    const [restockNeed, setRestockNeed] = useState<number>()
    const manager = isManager || isAdmin
    // Chuông = thông báo cá nhân: "Bổ sung tồn kho" của địa chỉ đang đứng (ai cũng thấy; chi nhánh thành viên kho chung thì không mua hàng)
    // và "Việc cần làm" gộp mọi địa chỉ (chỉ quản lý). Số trên chuông = số địa chỉ còn việc (đã gồm địa chỉ này) → không cộng dồn hai nhóm.
    const canRestock = warehouseRole !== 'member' && warehouseRole !== 'pending'
    const [bell, setBell] = useState<'list' | 'restock' | 'tasks' | null>(null)
    const [showMenu, setShowMenu] = useState(false)
    const [cached, setCached] = useState(pendingCount)
    const pending = manager ? cached : 0 // cache là số của quản lý (mọi địa chỉ) — nhân viên không có số này

    function go({ route, state }: Item) {
        setShowMenu(false)
        navigate(route, { state })
        if (route.startsWith('/history')) handleLoadHistory()
    }

    return (
        <>
            <AddressSwitcher />
            {!isGuest && (
                <button type="button" aria-label="Thông báo" onClick={() => setBell('list')} className={ICON_BTN}>
                    <Bell size={19} />
                    {pending > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-black flex items-center justify-center leading-none">!</span>
                    )}
                </button>
            )}
            <button type="button" aria-label="Menu" onClick={() => setShowMenu(true)} className={ICON_BTN}>
                <Menu size={20} />
            </button>
            {bell === 'list' && (
                <BottomSheet onClose={() => setBell(null)} panelClassName={SHEET_PANEL}>
                    <SheetHeader title="Thông báo" onClose={() => setBell(null)} />
                    <div className="flex flex-col gap-1.5">
                        {canRestock && <BellRow icon={Package} label="Bổ sung tồn kho" note={selectedAddress?.name ?? ''} count={restockNeed} onClick={() => setBell('restock')} />}
                        {manager && <BellRow icon={ClipboardList} label="Việc cần làm" note={`${pending} địa chỉ`} count={pending} onClick={() => setBell('tasks')} />}
                    </div>
                    {canRestock && warehouseRole !== 'hub' && current && (
                        <StockLoader key={current.id} unit={{ key: current.id, name: current.name, target: current, members: [current], hub: false }} onResult={(_, stat) => setRestockNeed(stat?.need)} />
                    )}
                </BottomSheet>
            )}
            {bell === 'tasks' && <AddressNotice onClose={() => { setBell(null); setCached(pendingCount()) }} />}
            {bell === 'restock' && (
                <WarehousePrepNotice
                    onClose={() => setBell(null)}
                    onOpenIngredient={ing => navigate(`/inventory/stocking/${encodeURIComponent(ing)}?scope=month`)}
                />
            )}
            {showMenu && (
                <Dialog
                    onClose={() => setShowMenu(false)}
                    panelClassName="w-full max-w-sm mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
                >
                    <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                        <p className="text-text font-black text-sm leading-none">Đi tới</p>
                        <button onClick={() => setShowMenu(false)} aria-label="Đóng" className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light shrink-0">
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
