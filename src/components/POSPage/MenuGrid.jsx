import { useMemo, useState, useRef } from 'react'
import { X, Check } from 'lucide-react'
import { formatVND } from '../../utils'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useProducts } from '../../contexts/ProductContext'

// Held item (qty>0): the WHOLE card is the gesture surface.
//   quick tap    → order another (onAdd)
//   press & hold → a green fill rises on the corner X (~600ms); when full it
//                  commits THIS last order (onCommit). Release mid-fill = abort.
//   tap corner X → cancel the held order (onCancel).
// CSS animation-delay keeps the green hidden during quick taps; commit fires on
// the fill's animationend so the visual == the action.
function ProductCard({ product, qty, onAdd, onCancel, onCommit }) {
    const held = qty > 0
    const [pressing, setPressing] = useState(false)   // fill mounted (covers the pre-delay window)
    const [engaged, setEngaged] = useState(false)     // green actually rising (past the delay) → show ✓
    const holdStarted = useRef(false)                 // fill animation began = this press is a hold, not a tap
    const suppressClick = useRef(false)               // swallow the click that trails a hold (commit or release)

    // Add fires on the card's onClick (kept for mouse/keyboard/screen-reader a11y).
    // A hold (commit, or release after the green started) leaves a trailing click
    // that must NOT add — suppressClick eats exactly that one click. Only pointerup
    // sets it (drag-off via leave/cancel produces no click, so it never sticks).
    const down = () => { holdStarted.current = false; setEngaged(false); setPressing(true) }
    const up = () => {
        setPressing(false); setEngaged(false)
        if (holdStarted.current) suppressClick.current = true
    }
    const abort = () => { setPressing(false); setEngaged(false) }
    const fillStart = () => { holdStarted.current = true; setEngaged(true) }
    const fillDone = () => { suppressClick.current = true; setPressing(false); setEngaged(false); onCommit() }
    const click = () => {
        if (suppressClick.current) { suppressClick.current = false; return }
        onAdd(product)
    }
    const stop = (e) => e.stopPropagation()
    const cancel = (e) => { e.stopPropagation(); onCancel() }

    return (
        <div
            id={`menu-${product.id}`}
            role="button"
            tabIndex={0}
            aria-pressed={held}
            aria-label={`Thêm ${product.name}`}
            onClick={click}
            onPointerDown={held ? down : undefined}
            onPointerUp={held ? up : undefined}
            onPointerLeave={held ? abort : undefined}
            onPointerCancel={held ? abort : undefined}
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

            {/* Corner X: tap = cancel. Hold lives on the card body; the green fill
                is driven by the card's pressing state but rendered here. */}
            {held && (
                <button
                    onPointerDown={stop}
                    onPointerUp={stop}
                    onClick={cancel}
                    aria-label={`Huỷ ${product.name}`}
                    className="absolute -top-4 -right-4 z-20 p-2.5 active:scale-90 transition-transform"
                >
                    <span className="relative w-7 h-7 rounded-full flex items-center justify-center shadow-lg border-2 border-primary/10 overflow-hidden bg-text">
                        {pressing && <span onAnimationStart={fillStart} onAnimationEnd={fillDone} className="absolute inset-0 bg-success origin-bottom hold-fill" />}
                        <span className={`relative z-10 ${engaged ? 'text-white' : 'text-bg'}`}>
                            {engaged ? <Check size={15} strokeWidth={3} /> : <X size={15} strokeWidth={3} />}
                        </span>
                    </span>
                </button>
            )}

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

export default function MenuGrid({ products, cart, onAddItem, onCancelHeld, onCommitHeld }) {
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
                {products.map(product => (
                    <ProductCard
                        key={product.id}
                        product={product}
                        qty={cartQtyMap.get(product.id) || 0}
                        onAdd={onAddItem}
                        onCancel={onCancelHeld}
                        onCommit={onCommitHeld}
                    />
                ))}
            </div>
        </main>
    )
}
