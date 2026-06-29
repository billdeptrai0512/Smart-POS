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
//   hold a fresh card   → adds + opens its extras as the fill engages; held to full = commit.
//   hold an active card → commit THIS order (onCommit). Release mid-fill = abort.
//   tap corner X        → cancel the active order (onCancel).
// A hold engages the card (activates it, opens extras) at the START of the fill, so
// touch-then-keep-pressing is ONE motion: see the extras, hold on to commit. Switching
// active can reflow the grid, but setPointerCapture keeps the press bound to this card.
// The fill doubles as the gesture's tutorial: hold a beat longer, watch the bar climb.

function ProductCard({ product, qty, onAdd, onCancel, onCommit, pressingRef }) {
    const held = qty > 0
    const [pressing, setPressing] = useState(false)   // fill mounted (covers the pre-delay window)
    const [engaged, setEngaged] = useState(false)     // green actually rising (past the delay) → show ✓
    const [pulseKey, setPulseKey] = useState(0)        // bump per tap-add → replays the confirm pulse
    const holdStarted = useRef(false)                 // fill animation began = this press is a hold, not a tap
    const suppressClick = useRef(false)               // swallow the click that trails a hold (commit or release)
    const pointer = useRef(null)                       // {el, id} of the live press, so capture can wait for engage

    // Taps add on pointerup (see up()); the trailing compatibility `click` must be eaten
    // so it can't add again — that's all suppressClick does now. Do NOT reset it on down:
    // a click lags its pointerup, so on rapid taps the PREVIOUS tap's click can land AFTER
    // the next down — resetting here un-suppresses it and DOUBLES the order. Leaving it set
    // is safe: up() adds independently of the flag, so a stale true never swallows a tap,
    // only an unwanted trailing click.
    // NB: do NOT setPointerCapture here — iOS Safari swallows the trailing `click` on a
    // captured element, so capturing every tap kills repeat taps on a held card. Capture
    // is deferred to engage (fillStart), where only real holds need it.
    const down = (e) => {
        pointer.current = { el: e.currentTarget, id: e.pointerId }
        holdStarted.current = false; setEngaged(false); setPressing(true)
    }
    const up = () => {
        setPressing(false); setEngaged(false)
        // Fire the TAP's add HERE on pointerup, not on the click: iOS Safari drops the
        // synthetic `click` on rapid repeat taps (it waits to see a double-tap), so
        // relying on click loses every tap after the first. A hold (holdStarted) instead
        // committed/aborted via the fill, so it must NOT add. Either way suppress the
        // trailing click (if one arrives) so it can never double-add.
        suppressClick.current = true
        pressingRef.current = false
        if (!holdStarted.current) { onAdd(product); setPulseKey(k => k + 1) }
    }
    // Same as up()'s guard: once engaged the item is already added, so suppress the
    // trailing click (if any follows a pointercancel/leave) — never let it re-add.
    const abort = () => { setPressing(false); setEngaged(false); pressingRef.current = false; if (holdStarted.current) suppressClick.current = true }
    // Engage = the press became a hold. Capture the pointer NOW (binds the hold to THIS
    // card so it survives the grid reflow below + finger drift), THEN activate a fresh
    // card (adds it, opens extras) so the hold doubles as "show me the options".
    const fillStart = () => {
        try { pointer.current?.el.setPointerCapture(pointer.current.id) } catch { /* inactive pointer */ }
        // Flag the press so ExtrasPopover skips scrollIntoView — activating mid-hold must
        // not scroll the grid out from under the finger.
        pressingRef.current = true
        holdStarted.current = true; setEngaged(true); if (!held) onAdd(product)
    }
    // Fill complete → commit. The add already happened at engage, so just close the order.
    const fillDone = () => { suppressClick.current = true; setPressing(false); setEngaged(false); pressingRef.current = false; onCommit() }
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

            {/* Confirm pulse: a primary ring that pings out on each tap-add — the ack the
                chained 1-tap flow otherwise lacks (card stays held, no toast). Keyed so it
                replays every tap. */}
            {pulseKey > 0 && <span key={pulseKey} className="tap-pulse absolute inset-0 rounded-[1.5rem] ring-2 ring-primary pointer-events-none z-30" />}

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
function ExtrasPopover({ activeProductId, extras, activeItem, enabledStickyExtraIds, onToggleExtra, onToggleStickyExtra, pressingRef }) {
    const { sticky, normal } = useMemo(() => {
        const s = [], n = []
        for (const e of extras) (e.is_sticky ? s : n).push(e)
        return { sticky: s, normal: n }
    }, [extras])

    // Tapping the bottom card drops the bar below the fold. Pull it into view when
    // the active item changes — `nearest` stays put if it's already visible.
    const ref = useRef(null)
    // Skip while a card is being pressed: a hold activating a fresh card would otherwise
    // scroll the grid out from under the finger mid-hold.
    useEffect(() => { if (!pressingRef.current) ref.current?.scrollIntoView({ block: 'nearest' }) }, [activeProductId])

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
    // Shared press flag: ProductCard sets it during a hold so ExtrasPopover can skip
    // scrollIntoView and not yank the grid under the finger mid-hold.
    const pressingRef = useRef(false)

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
                            pressingRef={pressingRef}
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
                            pressingRef={pressingRef}
                        />,
                    ]
                })}
            </div>
        </main>
    )
}
