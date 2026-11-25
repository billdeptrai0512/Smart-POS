import { ArrowLeftRight, BadgePercent, ChefHat, ClipboardCheck, MapPin, Package, Receipt, ScrollText, ShoppingBag, Store, TrendingUp, Users, type LucideIcon } from 'lucide-react'

// Mọi trang của app, nhóm theo khu vực (tab con của mỗi trang là một mục riêng) — khỏi bấm ‹ › lần lượt.
// Một nguồn cho menu "Điều hướng" (TopNav) và "Lối tắt" của từng địa chỉ (BranchGrid) để hai nơi luôn đồng bộ.
// manager: chỉ quản lý/admin thấy. noGuest: ẩn với khách dùng thử. state: truyền cho trang đích (Nhân viên = tab "staff" của /addresses).
export type NavItem = { icon: LucideIcon; label: string; tone: string; route: string; wide?: boolean; manager?: boolean; noGuest?: boolean; state?: { tab: string } }
export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
    { title: 'Quản lý', items: [{ icon: MapPin, label: 'Địa chỉ', tone: 'success', route: '/addresses', noGuest: true }, { icon: Users, label: 'Nhân viên', tone: 'info', route: '/addresses', manager: true, noGuest: true, wide: true, state: { tab: 'staff' } }] },
    { title: '', items: [{ icon: ShoppingBag, label: 'Bán hàng', tone: 'solid', route: '/pos', wide: true }] },
    { title: 'Nhật ký', items: [{ icon: ScrollText, label: 'Nhật ký', tone: 'success', route: '/history/sales' }, { icon: Receipt, label: 'Chi phí', tone: 'danger', route: '/history/expense' }] },
    { title: 'Báo cáo', items: [{ icon: ArrowLeftRight, label: 'Dòng tiền', tone: 'info', route: '/report/cashflow' }, { icon: TrendingUp, label: 'Lợi nhuận', tone: 'success', route: '/report/revenue' }] },
    { title: 'Tồn kho', items: [{ icon: ClipboardCheck, label: 'Kiểm kê', tone: 'info', route: '/inventory/management' }, { icon: Package, label: 'Tồn kho', tone: 'primary', route: '/inventory/stocking' }] },
    { title: 'Thực đơn', items: [{ icon: Store, label: 'Cửa hàng', tone: 'info', route: '/category/overall' }, { icon: ChefHat, label: 'Công thức', tone: 'primary', route: '/category/recipes' }, { icon: BadgePercent, label: 'Chương trình', tone: 'warning', route: '/category/discounts', wide: true }] },
]
