// Tab của 2 trang trong dashboard: Tồn kho (/inventory/:tab) và Danh mục (/category/:tab). key = đoạn cuối URL. Tách khỏi
// MenuTabsBar.tsx vì file component chỉ được export component (react-refresh/only-export-components).
export const INGREDIENT_TABS = [
    { key: 'management', label: 'Kiểm kê' },
    { key: 'stocking',   label: 'Tồn kho' },
]

// Chương trình khuyến mãi (/category/discounts) — vào từ nút/lối tắt, không nằm trong MenuTabsBar.
export const DISCOUNT_TAB = { key: 'discounts', label: 'Chương trình khuyến mãi' }
