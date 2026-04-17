import { formatVND } from '../../utils'
import { QUICK_EXTRAS } from '../../constants'

export default function OrderFooter({ cart, activeCartItemId, total, hasOrder, isSubmitting, onToggleExtra, onConfirm, productExtras }) {
    // Determine which extras to show based on the active cart item's product
    const activeItem = cart.find(item => item.cartItemId === activeCartItemId) || cart[cart.length - 1]
    const activeProductId = activeItem?.productId

    // Use per-product extras if available, otherwise fall back to global QUICK_EXTRAS
    const extrasToShow = (activeProductId && productExtras?.[activeProductId]?.length > 0)
        ? productExtras[activeProductId]
        : QUICK_EXTRAS

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 shadow-[0_-4px_24px_rgba(0,0,0,0.02)] flex flex-col">

            {/* Quick Extras Bar */}
            {cart.length > 0 && (
                <div className="w-full overflow-x-auto py-3 px-6 flex gap-2.5 items-center hide-scrollbar border-b border-border/40">
                    {extrasToShow.map(ex => {
                        const hasExtra = activeItem?.extras.some(e => e.id === ex.id) || false

                        if (!hasExtra) {
                            return (
                                <button
                                    key={ex.id}
                                    onClick={() => onToggleExtra(ex)}
                                    className="shrink-0 h-[42px] px-4 rounded-[14px] border bg-surface-light border-border/80 text-text-secondary hover:text-text font-bold text-[14px] whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all shadow-sm uppercase"
                                >
                                    {ex.name}
                                </button>
                            )
                        }

                        return (
                            <button
                                key={ex.id}
                                onClick={() => onToggleExtra(ex)}
                                className="shrink-0 flex items-center gap-1.5 h-[42px] px-4 rounded-[14px] border bg-primary/10 border-primary/50 text-primary font-bold text-[14px] whitespace-nowrap focus:outline-none shadow-sm backdrop-blur-sm active:bg-primary/20 uppercase"
                            >
                                <span className="w-1.5 h-1.5 rounded-full bg-primary mb-[1px] uppercase"></span>
                                {ex.name}
                            </button>
                        )
                    })}

                </div>
            )}

            <div className="px-6 pt-4 pb-4">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-text-secondary text-sm font-bold uppercase tracking-wider">Tổng cộng</span>
                    <span className="text-text font-black text-2xl tabular-nums tracking-tight">
                        {formatVND(total)}
                    </span>
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
        </footer>
    )
}

