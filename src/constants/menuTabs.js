// Ba tab dùng chung dashboard Menu/Nguyên liệu — /recipes (Công thức) và /ingredients
// (Nguyên liệu / Bao bì). Tách khỏi MenuTabsBar.jsx vì file component chỉ được export
// component (react-refresh/only-export-components) — RecipeMenuHeader/IngredientsHeader
// cũng cần đọc nhãn tab nên không thể khai cục bộ trong MenuTabsBar.jsx.
export const MENU_TABS = [
    { key: 'recipes',   label: 'Công thức' },
    { key: 'main',      label: 'Nguyên liệu' },
    { key: 'packaging', label: 'Bao bì' },
]
