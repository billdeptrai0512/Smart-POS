import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, BookOpen, Bell, ClipboardList, MapPin, Menu, Package } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useHistory } from '../../contexts/HistoryContext'
import { STOCK_CACHE_KEY } from '../../hooks/useRestockOverview'
import { MENU_SEQUENCE } from '../../utils/menuSequence'
import { readJSON } from '../../utils/storage'
import AddressNotice from '../AddressSelectPage/AddressNotice'
import { BottomSheet, SheetHeader, SHEET_PANEL } from '../common/ModalShell'
import AddressSwitcher from './AddressSwitcher'

const ICON_BTN = 'relative shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-bg border border-border/60 text-text-secondary active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

// Lối tắt tới 4 trang của mũi tên ‹ › (utils/menuSequence.ts) — khỏi bấm lần lượt.
const PAGE_UI: Record<string, { label: string; icon: ReactNode }> = {
    sales: { label: 'Nhật ký', icon: <ClipboardList size={18} /> },
    report: { label: 'Báo cáo', icon: <BarChart3 size={18} /> },
    main: { label: 'Tồn kho', icon: <Package size={18} /> },
    recipes: { label: 'Công thức', icon: <BookOpen size={18} /> },
}

// Số kho còn việc theo bản đã tính gần nhất (cache của "Việc cần làm") — đọc rẻ, không tải gì thêm lúc đang bán.
// Số tươi hơn có khi mở sheet (nó tải nền rồi cập nhật cache).
const pendingCount = () => Object.values(readJSON<Record<string, { need: number }>>(STOCK_CACHE_KEY, {})).filter(s => s.need > 0).length

// Hàng đầu của POS: ô địa chỉ (đổi tại chỗ) · chuông "Việc cần làm" · menu điều hướng.
export default function TopNav() {
    const { isGuest } = useAuth()
    const { handleLoadHistory } = useHistory()
    const navigate = useNavigate()
    const [showTasks, setShowTasks] = useState(false)
    const [showMenu, setShowMenu] = useState(false)
    const [pending, setPending] = useState(pendingCount)

    function go(route: string) {
        setShowMenu(false)
        navigate(route)
        if (route.startsWith('/history')) handleLoadHistory()
    }

    return (
        <>
            <AddressSwitcher />
            {!isGuest && (
                <button type="button" aria-label="Việc cần làm" onClick={() => setShowTasks(true)} className={ICON_BTN}>
                    <Bell size={19} />
                    {pending > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-black flex items-center justify-center leading-none">{pending}</span>
                    )}
                </button>
            )}
            <button type="button" aria-label="Menu" onClick={() => setShowMenu(true)} className={ICON_BTN}>
                <Menu size={20} />
            </button>
            {showTasks && <AddressNotice onClose={() => { setShowTasks(false); setPending(pendingCount()) }} />}
            {showMenu && (
                <BottomSheet onClose={() => setShowMenu(false)} panelClassName={SHEET_PANEL}>
                    <SheetHeader title="Đi tới" onClose={() => setShowMenu(false)} />
                    <div className="grid grid-cols-2 gap-2">
                        {MENU_SEQUENCE.map(s => (
                            <button
                                key={s.route}
                                type="button"
                                onClick={() => go(s.route)}
                                className="flex items-center gap-2.5 px-3 py-3.5 rounded-[14px] bg-bg border border-border/60 text-[14px] font-black text-text active:scale-[0.98] transition-all"
                            >
                                <span className="text-primary">{PAGE_UI[s.key].icon}</span>
                                {PAGE_UI[s.key].label}
                            </button>
                        ))}
                    </div>
                    {!isGuest && (
                        <button type="button" onClick={() => go('/addresses')} className="flex items-center justify-center gap-2 py-2 text-[12px] font-black uppercase tracking-wider text-text-secondary">
                            <MapPin size={14} /> Quản lý địa chỉ
                        </button>
                    )}
                </BottomSheet>
            )}
        </>
    )
}
