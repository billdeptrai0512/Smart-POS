// The ordered list of dashboard destinations the header ‹ › arrows walk through.
// "Next/prev page, not next tab": Nhật ký (/history), Báo cáo (/report),
// Tồn kho (/inventory), Công thức (/category).
// The arrows step through THIS list in order;
// stepping off either end exits to /pos (it's a bounded line, not a loop).
//
// stop shape: { key, route, dated? }
//   route    — điểm vào của trang (tab đầu tiên); tab trong trang nằm trên URL (/history/sales|expense…)
//   dated    — trang có khoảng ngày: nhận scopeState khi bước sang
export const MENU_SEQUENCE: { key: string; route: string; dated?: boolean }[] = [
    { key: 'sales', route: '/history/sales', dated: true },   // Nhật ký
    { key: 'report', route: '/report/cashflow', dated: true },        // Báo cáo
    { key: 'main', route: '/inventory/management' },             // Tồn kho
    { key: 'recipes', route: '/category/overall' },               // Danh mục
]

const KEY_MAP: Record<string, string> = {
    expense: 'sales',
}

const resolveKey = (key: string) => KEY_MAP[key] || key

const indexOfKey = (key: string) => MENU_SEQUENCE.findIndex(s => s.key === resolveKey(key))

// Where the arrows land when stepping off either end of the sequence.
export const MENU_BOUNDARY_ROUTE = '/pos'

// Step ±1 through the sequence. The list is a bounded line, NOT a loop:
// stepping before the first stop or past the last returns null, signalling the
// caller to exit to MENU_BOUNDARY_ROUTE.
export function menuStep(currentKey: string, dir: number) {
    const i = indexOfKey(currentKey)
    if (i === -1) return MENU_SEQUENCE[0]
    const n = i + dir
    if (n < 0 || n >= MENU_SEQUENCE.length) return null
    return MENU_SEQUENCE[n]
}

// Apply a sequence step from the page identified by `currentKey`: navigate to the target stop's route. Stepping off either
// end exits to /pos (the dashboard's natural entry point).
//   ctx.navigate      — react-router navigate
//   ctx.backTo        — preserved as `from` in nav state
//   ctx.scopeState    — { scope, offset, customRange } carried into /history and
//                       /report so the date window survives the Nhật ký ↔ Báo cáo jump
interface MenuStepCtx {
    navigate: (to: string, opts?: { state: Record<string, unknown> }) => void
    backTo?: string | null
    scopeState?: Record<string, unknown>
    wizard?: boolean
}
export function goToMenuStep(currentKey: string, dir: number, ctx: MenuStepCtx) {
    const target = menuStep(currentKey, dir)
    const { navigate, backTo, scopeState, wizard } = ctx

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

    navigate(target.route, {
        state: { from: backTo, wizard: true, ...(target.dated && scopeState) },
    })
}
