// The ordered list of dashboard destinations the header ‹ › arrows walk through.
// "Next/prev tab, not next route": the first three are tabs (two of them share
// the /history route), the last three are the recipes/ingredients views (two
// share the /ingredients route). The arrows step through THIS list in order;
// stepping off either end exits to /pos (it's a bounded line, not a loop).
//
// stop shape: { key, route, tab?, viewMode? }
//   tab      — HistoryPage activeTab ('orders' | 'expense')
//   viewMode — IngredientManagementPage viewMode ('main' | 'packaging')
export const MENU_SEQUENCE = [
    { key: 'orders',    route: '/history',      tab: 'orders' },     // Thu nhập
    { key: 'expense',   route: '/history',      tab: 'expense' },    // Chi phí
    { key: 'report',    route: '/daily-report' },                    // Báo cáo
    { key: 'recipes',   route: '/recipes' },                         // Công thức
    { key: 'main',      route: '/ingredients',  viewMode: 'main' },  // Nguyên liệu
    { key: 'packaging', route: '/ingredients',  viewMode: 'packaging' }, // Bao bì
]

const indexOfKey = (key) => MENU_SEQUENCE.findIndex(s => s.key === key)

// Where the arrows land when stepping off either end of the sequence.
export const MENU_BOUNDARY_ROUTE = '/pos'

// Step ±1 through the sequence. The list is a bounded line, NOT a loop:
// stepping before the first stop or past the last returns null, signalling the
// caller to exit to MENU_BOUNDARY_ROUTE.
export function menuStep(currentKey, dir) {
    const i = indexOfKey(currentKey)
    if (i === -1) return MENU_SEQUENCE[0]
    const n = i + dir
    if (n < 0 || n >= MENU_SEQUENCE.length) return null
    return MENU_SEQUENCE[n]
}

export const menuNext = (key) => menuStep(key, +1)
export const menuPrev = (key) => menuStep(key, -1)

// Apply a sequence step from the page identified by `currentKey`. Same-route
// stops switch local tab/view state (no navigation); cross-route stops navigate,
// carrying viewMode / report-tab intent via location state. Stepping off either
// end exits to /pos (the dashboard's natural entry point).
//   ctx.navigate      — react-router navigate
//   ctx.backTo        — preserved as `from` in nav state
//   ctx.setActiveTab  — HistoryPage: switch orders/expense in place
//   ctx.setViewMode   — IngredientManagementPage: switch main/packaging in place
//   ctx.goReport      — HistoryPage: scope-aware /daily-report nav (handleReportNav)
export function goToMenuStep(currentKey, dir, ctx) {
    const target = menuStep(currentKey, dir)
    const { navigate, backTo, setActiveTab, setViewMode, goReport } = ctx

    // Off the end of the line → leave the dashboard.
    if (!target) { navigate(MENU_BOUNDARY_ROUTE); return }

    const cur = MENU_SEQUENCE.find(s => s.key === currentKey)

    // Same route → flip local state, no navigation.
    if (cur && target.route === cur.route) {
        if (target.tab && setActiveTab) { setActiveTab(target.tab); return }
        if (target.viewMode && setViewMode) { setViewMode(target.viewMode); return }
    }

    switch (target.route) {
        case '/history':
            navigate('/history', { state: { from: backTo, tab: target.tab } })
            break
        case '/daily-report':
            if (goReport) goReport()
            else navigate('/daily-report', { state: { from: backTo } })
            break
        case '/ingredients':
            navigate('/ingredients', { state: { from: backTo, viewMode: target.viewMode } })
            break
        default:
            navigate(target.route, { state: { from: backTo } })
    }
}
