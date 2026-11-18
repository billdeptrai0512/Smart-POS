import { Banknote, ClipboardCheck, FileText, LayoutGrid, Package, Receipt, ShoppingBag, Tag, TrendingUp, Users, Wallet, type LucideIcon } from 'lucide-react'

// Mọi trang của app, nhóm theo khu vực (tab con của mỗi trang là một mục riêng) — khỏi bấm ‹ › lần lượt.
// Một nguồn cho menu "Điều hướng" (TopNav) và "Lối tắt" của từng địa chỉ (BranchGrid) để hai nơi luôn đồng bộ.
// manager: chỉ quản lý/admin thấy. noGuest: ẩn với khách dùng thử. state: truyền cho trang đích (Nhân viên = tab "staff" của /addresses).
export type NavItem = { icon: LucideIcon; label: string; tone: string; route: string; wide?: boolean; manager?: boolean; noGuest?: boolean; state?: { tab: string } }
export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
    { title: '', items: [{ icon: ShoppingBag, label: 'Tạo đơn', tone: 'primary', route: '/pos', wide: true }] },
    { title: 'Nhật ký', items: [{ icon: Receipt, label: 'Đơn bán', tone: 'primary', route: '/history/sales' }, { icon: Wallet, label: 'Chi phí', tone: 'primary', route: '/history/expense' }] },
    { title: 'Báo cáo', items: [{ icon: Banknote, label: 'Dòng tiền', tone: 'success', route: '/report/cashflow' }, { icon: TrendingUp, label: 'Lợi nhuận', tone: 'success', route: '/report/revenue' }] },
    { title: 'Tồn kho', items: [{ icon: ClipboardCheck, label: 'Kiểm kê', tone: 'primary', route: '/inventory/management' }, { icon: Package, label: 'Lưu trữ', tone: 'primary', route: '/inventory/stocking' }] },
    { title: 'Danh mục', items: [{ icon: LayoutGrid, label: 'Menu', tone: 'primary', route: '/category/overall' }, { icon: FileText, label: 'Công thức', tone: 'primary', route: '/category/recipes' }, { icon: Tag, label: 'Chương trình khuyến mãi', tone: 'warning', route: '/category/discounts', wide: true }] },
    { title: 'Quản lý', items: [{ icon: Users, label: 'Nhân viên', tone: 'primary', route: '/addresses', manager: true, noGuest: true, wide: true, state: { tab: 'staff' } }] },
]
