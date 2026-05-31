import { useMemo, useState } from 'react'
import { formatVND } from '../../utils'
import DiscountModal from './DiscountModal'

export default function OrderFooter({ cart, activeCartItemId, total, hasOrder, isSubmitting, onToggleExtra, onConfirm, productExtras, enabledStickyExtraIds = [], onToggleStickyExtra, discount = { type: 'percent', value: 0 }, discountAmount = 0, finalTotal = total, onApplyDiscount }) {
    const [showDiscount, setShowDiscount] = useState(false)
    // Determine which extras to show based on the active cart item's product
    const activeItem = cart.find(item => item.cartItemId === activeCartItemId) || cart[cart.length - 1]
    const activeProductId = activeItem?.productId

    const extrasToShow = productExtras?.[activeProductId] || []

    // PERF: split extras into sticky/normal once per extras change instead of 2x per render.
    const { stickyExtrasToShow, normalExtrasToShow } = useMemo(() => {
        const sticky = [], normal = []
        for (const e of extrasToShow) (e.is_sticky ? sticky : normal).push(e)
        return { stickyExtrasToShow: sticky, normalExtrasToShow: normal }
    }, [extrasToShow])

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 shadow-[0_-4px_24px_rgba(0,0,0,0.02)] flex flex-col">

            {/* Quick Extras Bar */}
            {cart.length > 0 && extrasToShow.length > 0 && (
                <div className="w-full overflow-x-auto py-2.5 px-6 flex gap-2 items-center hide-scrollbar border-b border-border/40">
                    {/* Sticky extras — only when the active product actually has them */}
                    {stickyExtrasToShow.length > 0 && (
                        <>
                            {stickyExtrasToShow.map(ex => {
                                const isGlobalEnabled = enabledStickyExtraIds.includes(ex.id)
                                if (!isGlobalEnabled) {
                                    return (
                                        <button
                                            key={ex.id}
                                            onClick={() => onToggleStickyExtra(ex)}
                                            className="shrink-0 h-[34px] px-3 rounded-[10px] border bg-surface-light border-border/80 text-text-secondary hover:text-text font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase"
                                        >
                                            {ex.name}
                                        </button>
                                    )
                                }
                                return (
                                    <button
                                        key={ex.id}
                                        onClick={() => onToggleStickyExtra(ex)}
                                        className="shrink-0 flex items-center gap-1.5 h-[34px] px-3 rounded-[10px] border bg-warning/10 border-warning/50 text-warning font-bold text-[12px] whitespace-nowrap focus:outline-none shadow-sm active:bg-warning/20 uppercase"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-warning mb-[1px]"></span>
                                        {ex.name}
                                    </button>
                                )
                            })}

                            <div className="w-px h-5 bg-border/40 shrink-0" />
                        </>
                    )}

                    {normalExtrasToShow.map(ex => {
                        const hasExtra = activeItem?.extras.some(e => e.id === ex.id) || false

                        if (!hasExtra) {
                            return (
                                <button
                                    key={ex.id}
                                    onClick={() => onToggleExtra(ex)}
                                    className="shrink-0 h-[34px] px-3 rounded-[10px] border bg-surface-light border-border/80 text-text-secondary hover:text-text font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase"
                                >
                                    {ex.name}
                                </button>
                            )
                        }

                        return (
                            <button
                                key={ex.id}
                                onClick={() => onToggleExtra(ex)}
                                className="shrink-0 flex items-center gap-1.5 h-[34px] px-3 rounded-[10px] border bg-primary/10 border-primary/50 text-primary font-bold text-[12px] whitespace-nowrap focus:outline-none shadow-sm active:bg-primary/20 uppercase"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-primary mb-[1px]"></span>
                                {ex.name}
                            </button>
                        )
                    })}
                </div>
            )}

            <div className="px-6 pt-4 pb-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                        {hasOrder && (
                            <button
                                onClick={() => setShowDiscount(true)}
                                className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] uppercase tracking-wider whitespace-nowrap focus:outline-none transition-colors shadow-sm ${discountAmount > 0
                                    ? 'bg-primary/10 border-primary/50 text-primary'
                                    : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                            >
                                Giảm giá
                            </button>
                        )}
                        {/* Hidden on ultra-narrow screens (e.g. Z Fold cover ~280px) where the
                            Giảm giá pill + label + price can't share one row — the bold total
                            number is self-evidently the total there. nowrap prevents a mid-word
                            "Tổng / Cộng" split on the borderline. */}
                        <span className="text-text-secondary text-sm font-bold uppercase tracking-wider whitespace-nowrap hidden min-[360px]:inline">Tổng cộng</span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                        <span className="text-text font-black text-2xl tabular-nums tracking-tight">
                            {formatVND(finalTotal)}
                        </span>
                        {discountAmount > 0 && (
                            <span className="text-primary text-[12px] font-bold tabular-nums">−{formatVND(discountAmount)}</span>
                        )}
                    </div>
                </div>
                <button
                    id="confirm-order"
                    onClick={onConfirm}
                    disabled={!hasOrder || isSubmitting}
                    className={`w-full p-4 font-bold text-[18px] tracking-tight transition-all duration-75 flex items-center justify-center gap-2 ${!hasOrder || isSubmitting
                        ? 'bg-surface-light text-text-dim cursor-not-allowed border border-border/50'
                        : 'bg-primary text-bg active:bg-primary-hover shadow-[0_8px_32px_var(--color-primary-glow)] hover:-translate-y-0.5'
                        }`}
                >
                    {isSubmitting ? 'Đang tạo đơn...' : 'Tạo đơn'}
                </button>
            </div>
            {/* Safe area padding for notched phones */}
            <div className="h-[env(safe-area-inset-bottom,12px)]" />

            <DiscountModal
                open={showDiscount}
                onClose={() => setShowDiscount(false)}
                subtotal={total}
                discount={discount}
                onApply={onApplyDiscount}
            />
        </footer>
    )
}

