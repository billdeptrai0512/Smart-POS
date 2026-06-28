import { useMemo, useState, useRef, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import { formatVND } from '../../utils'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useProducts } from '../../contexts/ProductContext'

// The WHOLE card is the gesture surface. A green fill rises on the corner badge
// while you hold and COMMITS the order when the fill completes (on its animationend,
// so the visual == the action). The press is captured (setPointerCapture) so the
// hold survives grid reflow + finger drift. CSS animation-delay hides it on quick taps.
//   tap (any card)      → activate/order that item (onAdd); extras bar opens
//   hold a fresh card   → commit a 1-item order in one press. Release mid-fill = abort.
//   hold an active card → commit THIS order (onCommit). Release mid-fill = abort.
//   tap corner X        → cancel the active order (onCancel).
// Holding never switches the active card until the commit lands, so an open extras
// bar (and the cards under your finger) stay put through the whole hold.
// The fill doubles as the gesture's tutorial: hold a beat longer, watch the bar climb.

function ProductCard({ product, qty, onAdd, onCancel, onCommit }) {
    const held = qty > 0
    const [pressing, setPressing] = useState(false)   // fill mounted (covers the pre-delay window)
    const [engaged, setEngaged] = useState(false)     // green actually rising (past the delay) → show ✓
    const holdStarted = useRef(false)                 // fill animation began = this press is a hold, not a tap
    const suppressClick = useRef(false)               // swallow the click that trails a hold (commit or release)

    // Add fires on the card's onClick (kept for mouse/keyboard/screen-reader a11y).
    // A hold (commit, or a held card's mid-fill release) leaves a trailing click
    // that must NOT add — suppressClick eats exactly that one click.
    // Reset suppressClick every press: a long-press commit can release with no
    // trailing click (common on touch), leaving it stuck true → the next tap would
    // be swallowed. Clearing here means a stale flag can never outlive its gesture.
    // setPointerCapture binds the hold to THIS card for the whole press, so the
    // gesture survives the grid reflow when the active card's extras bar moves, and
    // any finger drift over the long hold — instead of firing pointerleave → abort.
    const down = (e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic / inactive pointer */ }
        holdStarted.current = false; suppressClick.current = false; setEngaged(false); setPressing(true)
    }
    const up = () => {
        setPressing(false); setEngaged(false)
        // Past the delay (holdStarted) the press is a hold: releasing before the fill
        // completes is an ABORT — suppress the trailing click so nothing is added.
        // A sub-delay tap never engages, so its click falls through to onAdd normally.
        if (holdStarted.current) suppressClick.current = true
    }
    const abort = () => { setPressing(false); setEngaged(false) }
    const fillStart = () => { holdStarted.current = true; setEngaged(true) }
    // Fill complete → commit. Activating happens HERE, not mid-hold, so a hold never
    // switches the active item (reflowing the grid) until the order closes. Fresh
    // card: add then commit — handleAddItem sets cartRef synchronously. Held: commit.
    const fillDone = () => { suppressClick.current = true; setPressing(false); setEngaged(false); if (!held) onAdd(product); onCommit() }
    const click = () => {
        if (suppressClick.current) { suppressClick.current = false; return }
        onAdd(product)
    }
    const stop = (e) => e.stopPropagation()
    const cancel = (e) => { e.stopPropagation(); onCancel() }

    // Shared circle: green fill (while pressing) under an X, swapped to ✓ once the
    // hold engages. Rendered in a bare span during a press, or the cancel button at rest.
    const badge = (
        <span className="relative w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 border-primary/10 overflow-hidden bg-text">
            {pressing && <span onAnimationStart={fillStart} onAnimationEnd={fillDone} className="absolute inset-0 bg-success origin-bottom hold-fill" />}
            <span className="relative z-10 text-bg">
                {engaged ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
            </span>
        </span>
    )

    return (
        <div
            id={`menu-${product.id}`}
            role="button"
            tabIndex={0}
            aria-pressed={held}
            aria-label={`Thêm ${product.name}`}
            onClick={click}
            onPointerDown={down}
            onPointerUp={up}
            onPointerLeave={abort}
            onPointerCancel={abort}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(product) }
            }}
            className={`menu-btn relative rounded-[1.5rem] p-3 sm:p-4 text-left min-h-[100px] flex flex-col justify-between border cursor-pointer transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-primary/30 ${held
                ? 'bg-gradient-to-br from-primary/15 to-primary/5 border-primary/40 shadow-[0_8px_24px_var(--color-primary-glow)] ring-1 ring-primary/20'
                : 'bg-surface border-border/60 shadow-sm hover:border-text/30 hover:shadow-md hover:bg-surface-hover'
                }`}
        >
            {/* Glow Effect */}
            {held && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />}

            {/* Corner badge. During a press: the rising fill (fresh cards stay invisible
                until engaged so quick taps don't flash). At rest, when active: X = cancel. */}
            {pressing ? (
                <span className={`absolute -top-4 -right-4 z-20 p-2.5 pointer-events-none transition-opacity ${engaged || held ? 'opacity-100' : 'opacity-0'}`}>
                    {badge}
                </span>
            ) : held ? (
                <button
                    onPointerDown={stop}
                    onPointerUp={stop}
                    onClick={cancel}
                    aria-label={`Huỷ ${product.name}`}
                    className="absolute -top-4 -right-4 z-20 p-2.5 active:scale-90 transition-transform"
                >
                    {badge}
                </button>
            ) : null}

            {/* Top: Name */}
            <div className="relative z-10 w-full">
                <h3 className={`font-black text-[15px] sm:text-[16px] leading-tight break-words pt-0.25 ${held ? 'text-primary drop-shadow-sm' : 'text-text'}`}>
                    {product.name}
                </h3>
            </div>

            {/* Bottom: Price */}
            <div className="flex items-end justify-between mt-3 relative z-10 w-full gap-2">
                <span className={`font-extrabold text-[13px] pb-1 ${held ? 'text-primary/90' : 'text-text-secondary'}`}>
                    {formatVND(product.price)}
                </span>
            </div>
        </div>
    )
}

// Extras for the active (held) item. Inserted as a full-width grid item right
// after the active card's row (see MenuGrid) so it pushes the cards below down
// instead of covering them — no reflow holes regardless of column/row.
function ExtrasPopover({ activeProductId, extras, activeItem, enabledStickyExtraIds, onToggleExtra, onToggleStickyExtra }) {
    const { sticky, normal } = useMemo(() => {
        const s = [], n = []
        for (const e of extras) (e.is_sticky ? s : n).push(e)
        return { sticky: s, normal: n }
    }, [extras])

    // Tapping the bottom card drops the bar below the fold. Pull it into view when
    // the active item changes — `nearest` stays put if it's already visible.
    const ref = useRef(null)
    useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }) }, [activeProductId])

    return (
        <div ref={ref} className="col-span-2 bg-surface border border-border/80 rounded-[14px] shadow-xl shadow-black/10">
            <div className="w-full overflow-x-auto py-2.5 px-3 flex gap-2 items-center hide-scrollbar">
                {sticky.map(ex => {
                    const on = enabledStickyExtraIds.includes(ex.id)
                    return (
                        <button
                            key={ex.id}
                            onClick={() => onToggleStickyExtra(ex)}
                            className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase flex items-center gap-1.5 ${on ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                        >
                            {on && <span className="w-1.5 h-1.5 rounded-full bg-warning mb-[1px]" />}
                            {ex.name}
                        </button>
                    )
                })}

                {sticky.length > 0 && normal.length > 0 && (
                    <div className="w-px h-5 bg-border/40 shrink-0" />
                )}

                {normal.map(ex => {
                    const on = activeItem?.extras.some(e => e.id === ex.id) || false
                    return (
                        <button
                            key={ex.id}
                            onClick={() => onToggleExtra(ex)}
                            className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase flex items-center gap-1.5 ${on ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                        >
                            {on && <span className="w-1.5 h-1.5 rounded-full bg-primary mb-[1px]" />}
                            {ex.name}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

export default function MenuGrid({ products, cart, onAddItem, onCancelHeld, onCommitHeld, productExtras, activeCartItemId, onToggleExtra, enabledStickyExtraIds = [], onToggleStickyExtra }) {
    const navigate = useNavigate()
    const { isManager, isAdmin } = useAuth()
    const { loading, loadError } = useProducts()
    const canSetup = isManager || isAdmin

    // PERF: index cart qty by productId once per cart change.
    // Was: cart.filter().reduce() called per product per render — O(N×M).
    const cartQtyMap = useMemo(() => {
        const map = new Map()
        for (const item of cart) {
            map.set(item.productId, (map.get(item.productId) || 0) + item.quantity)
        }
        return map
    }, [cart])

    // Active (held) item whose extras show. Mirrors the old footer's pick:
    // explicit active id, else the last held item.
    const activeItem = cart.find(i => i.cartItemId === activeCartItemId) || cart[cart.length - 1]
    const activeProductId = activeItem?.productId
    const activeExtras = productExtras?.[activeProductId] || []
    const activeIdx = activeExtras.length > 0 ? products.findIndex(p => p.id === activeProductId) : -1
    // Insert the extras bar after the END of the active card's row (its right-col
    // neighbour, or the card itself if it's right-col / last) so the full-width
    // span drops to a fresh row with no empty grid slot beside it.
    const extrasAfterIdx = activeIdx < 0 ? -1
        : activeIdx % 2 === 0 ? Math.min(activeIdx + 1, products.length - 1)
            : activeIdx

    if (products.length === 0) {
        const isLoading = loading
        const hasError = !!loadError
        const title = isLoading
            ? 'Đang tải menu…'
            : hasError
                ? 'Không tải được menu'
                : 'Chưa có món nào trong menu'
        const description = isLoading
            ? 'Vui lòng chờ giây lát.'
            : hasError
                ? (navigator.onLine
                    ? 'Có lỗi khi tải dữ liệu. Thử tải lại trang.'
                    : 'Đang offline. Khi có mạng dữ liệu sẽ tự đồng bộ.')
                : (canSetup
                    ? 'Thiết lập menu và công thức để bắt đầu bán hàng.'
                    : 'Liên hệ quản lý để được thiết lập menu.')

        return (
            <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-6 pb-6 pt-5 flex items-center justify-center">
                <div className="bg-surface border border-border/60 rounded-[24px] p-6 max-w-sm w-full text-center shadow-sm">
                    <div className="text-[15px] font-black text-text mb-1.5">{title}</div>
                    <div className="text-[13px] text-text-secondary mb-4 leading-relaxed">{description}</div>
                    {!isLoading && hasError && (
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors uppercase"
                        >
                            Tải lại
                        </button>
                    )}
                    {!isLoading && !hasError && canSetup && (
                        <button
                            onClick={() => navigate('/recipes', { state: { from: '/pos' } })}
                            className="w-full py-3 rounded-[12px] bg-primary text-bg font-black text-[14px] hover:bg-primary/90 active:bg-primary/80 transition-colors uppercase"
                        >
                            Thiết lập menu
                        </button>
                    )}
                </div>
            </main>
        )
    }

    return (
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 px-6 pb-6 pt-5">
            <div className="grid grid-cols-2 gap-4 pt-1">
                {products.map((product, idx) => {
                    const card = (
                        <ProductCard
                            key={product.id}
                            product={product}
                            qty={cartQtyMap.get(product.id) || 0}
                            onAdd={onAddItem}
                            onCancel={onCancelHeld}
                            onCommit={onCommitHeld}
                        />
                    )
                    if (idx !== extrasAfterIdx) return card
                    return [
                        card,
                        <ExtrasPopover
                            key="extras"
                            activeProductId={activeProductId}
                            extras={activeExtras}
                            activeItem={activeItem}
                            enabledStickyExtraIds={enabledStickyExtraIds}
                            onToggleExtra={onToggleExtra}
                            onToggleStickyExtra={onToggleStickyExtra}
                        />,
                    ]
                })}
            </div>
        </main>
    )
}
