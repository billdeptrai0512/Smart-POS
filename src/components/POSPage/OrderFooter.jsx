import { useMemo } from 'react'

export default function OrderFooter({ cart, activeCartItemId, onToggleExtra, productExtras, enabledStickyExtraIds = [], onToggleStickyExtra }) {
    const activeItem = cart.find(item => item.cartItemId === activeCartItemId) || cart[cart.length - 1]
    const activeProductId = activeItem?.productId
    const extrasToShow = productExtras?.[activeProductId] || []

    const { stickyExtrasToShow, normalExtrasToShow } = useMemo(() => {
        const sticky = [], normal = []
        for (const e of extrasToShow) (e.is_sticky ? sticky : normal).push(e)
        return { stickyExtrasToShow: sticky, normalExtrasToShow: normal }
    }, [extrasToShow])

    const hasItemExtras = cart.length > 0 && extrasToShow.length > 0
    if (!hasItemExtras) return null

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
            <div className="w-full overflow-x-auto py-2.5 px-4 flex gap-2 items-center hide-scrollbar">
                {stickyExtrasToShow.map(ex => {
                    const isGlobalEnabled = enabledStickyExtraIds.includes(ex.id)
                    return (
                        <button
                            key={ex.id}
                            onClick={() => onToggleStickyExtra(ex)}
                            className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase flex items-center gap-1.5 ${isGlobalEnabled ? 'bg-warning/10 border-warning/50 text-warning' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                        >
                            {isGlobalEnabled && <span className="w-1.5 h-1.5 rounded-full bg-warning mb-[1px]" />}
                            {ex.name}
                        </button>
                    )
                })}

                {stickyExtrasToShow.length > 0 && normalExtrasToShow.length > 0 && (
                    <div className="w-px h-5 bg-border/40 shrink-0" />
                )}

                {normalExtrasToShow.map(ex => {
                    const hasExtra = activeItem?.extras.some(e => e.id === ex.id) || false
                    return (
                        <button
                            key={ex.id}
                            onClick={() => onToggleExtra(ex)}
                            className={`shrink-0 h-[34px] px-3 rounded-[10px] border font-bold text-[12px] whitespace-nowrap focus:outline-none transition-all shadow-sm uppercase flex items-center gap-1.5 ${hasExtra ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-surface-light border-border/80 text-text-secondary hover:text-text'}`}
                        >
                            {hasExtra && <span className="w-1.5 h-1.5 rounded-full bg-primary mb-[1px]" />}
                            {ex.name}
                        </button>
                    )
                })}
            </div>

            <div className="h-[env(safe-area-inset-bottom,12px)]" />
        </footer>
    )
}
