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
    { key: 'orders', route: '/history', tab: 'orders' },     // Thu nhập
    { key: 'recipes', route: '/recipes', viewMode: 'main' },  // Nguyên liệu
]

const KEY_MAP = {
    expense: 'orders',
    report: 'orders',
    main: 'recipes',
    packaging: 'recipes',
}

const resolveKey = (key) => KEY_MAP[key] || key

const indexOfKey = (key) => MENU_SEQUENCE.findIndex(s => s.key === resolveKey(key))

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

// Apply a sequence step from the page identified by `currentKey`. Same-route
// stops switch local tab/view state (no navigation); cross-route stops navigate,
// carrying viewMode / report-tab intent via location state. Stepping off either
// end exits to /pos (the dashboard's natural entry point).
//   ctx.navigate      — react-router navigate
//   ctx.backTo        — preserved as `from` in nav state
//   ctx.setActiveTab  — HistoryPage: switch orders/expense in place
//   ctx.setViewMode   — IngredientManagementPage: switch main/packaging in place
//   ctx.goReport      — HistoryPage: scope-aware /daily-report nav (handleReportNav)
//   ctx.scopeState    — { scope, offset, customRange } carried into /history so the
//                       date window survives the Báo cáo → Thu nhập/Chi phí jump
export function goToMenuStep(currentKey, dir, ctx) {
    const target = menuStep(currentKey, dir)
    const { navigate, backTo, setActiveTab, setViewMode, scopeState, wizard } = ctx

    // If not in wizard mode and going back, return directly to the entry point (backTo).
    if (dir === -1 && !wizard) {
        navigate(backTo || MENU_BOUNDARY_ROUTE)
        return
    }

    // Off the end of the line → leave the dashboard.
    if (!target) {
        navigate(dir === -1 ? (backTo || MENU_BOUNDARY_ROUTE) : MENU_BOUNDARY_ROUTE)
        return
    }

    const cur = MENU_SEQUENCE.find(s => s.key === resolveKey(currentKey))

    // Same route → flip local state, no navigation.
    if (cur && target.route === cur.route) {
        if (target.tab && setActiveTab) { setActiveTab(target.tab); return }
        if (target.viewMode && setViewMode) { setViewMode(target.viewMode); return }
    }

    switch (target.route) {
        case '/history':
            navigate('/history', { state: { from: backTo, tab: target.tab, wizard: true, ...scopeState } })
            break
        case '/recipes':
            navigate('/recipes', { state: { from: backTo, wizard: true } })
            break
        default:
            navigate(target.route, { state: { from: backTo, wizard: true } })
    }
}
