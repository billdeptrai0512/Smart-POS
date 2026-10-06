// Tab của 2 trang trong dashboard: Tồn kho (/ingredients) và Công thức (/recipes). Tách khỏi
// MenuTabsBar.jsx vì file component chỉ được export component (react-refresh/only-export-components).
export const INGREDIENT_TABS = [
    { key: 'main',      label: 'Kiểm kê' },
    { key: 'warehouse', label: 'Lưu trữ' },
]

export const RECIPE_TABS = [
    { key: 'overview', label: 'Tổng quát' },
    { key: 'recipes',  label: 'Công thức' },
]
