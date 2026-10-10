// Tab của 2 trang trong dashboard: Tồn kho (/inventory/:tab) và Danh mục (/category/:tab). key = đoạn cuối URL. Tách khỏi
// MenuTabsBar.tsx vì file component chỉ được export component (react-refresh/only-export-components).
export const INGREDIENT_TABS = [
    { key: 'management', label: 'Kiểm kê' },
    { key: 'stocking',   label: 'Lưu trữ' },
]

export const RECIPE_TABS = [
    { key: 'overall', label: 'Menu' },
    { key: 'recipes', label: 'Công thức' },
]

// Mục thứ 3 của /category/* — không nằm trong MenuTabsBar (vào từ nút/lối tắt) nên tách riêng khỏi RECIPE_TABS.
export const DISCOUNT_TAB = { key: 'discounts', label: 'Chương trình khuyến mãi' }
