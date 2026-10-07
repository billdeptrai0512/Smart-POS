// Tab của 2 trang trong dashboard: Tồn kho (/inventory/:tab) và Danh mục (/category/:tab). key = đoạn cuối URL. Tách khỏi
// MenuTabsBar.jsx vì file component chỉ được export component (react-refresh/only-export-components).
export const INGREDIENT_TABS = [
    { key: 'management', label: 'Kiểm kê' },
    { key: 'stocking',   label: 'Lưu trữ' },
]

export const RECIPE_TABS = [
    { key: 'overall', label: 'Menu' },
    { key: 'recipes', label: 'Công thức' },
]
