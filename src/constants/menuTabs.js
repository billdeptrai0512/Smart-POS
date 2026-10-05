// Hai tab dùng chung dashboard Menu/Nguyên liệu — /recipes (Công thức) và /ingredients
// (Kiểm kê = nguyên liệu + bao bì, phân biệt bằng nhóm). Tách khỏi MenuTabsBar.jsx vì file component chỉ được export
// component (react-refresh/only-export-components) — MenuPageHeader cũng cần đọc
// nhãn tab nên không thể khai cục bộ trong MenuTabsBar.jsx.
export const MENU_TABS = [
    { key: 'main',      label: 'Kiểm kê' },
    { key: 'recipes',   label: 'Công thức' },
]
