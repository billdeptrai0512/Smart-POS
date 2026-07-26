import { useEffect, useRef } from 'react'
import { useCart } from '../contexts/CartContext'
import { useStats } from '../contexts/StatsContext'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import { useOrderOnboardingProgress } from '../hooks/useOrderOnboardingProgress'
import { useNavigate } from 'react-router-dom'
import { DAY_NAMES } from '../constants'
import { dateFullVN } from '../utils/dateVN'

import Header from '../components/POSPage/Header'
import MenuGrid from '../components/POSPage/MenuGrid'
import Toast from '../components/POSPage/Toast'

export default function POSPage() {
    const navigate = useNavigate()
    const { isGuest } = useAuth()
    const { products, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const {
        cart, activeCartItemId,
        handleAddItem, cancelHeld, handleToggleExtra,
        toast, recentOrders, draftOrder, enterKey,
        enabledStickyExtraIds,
        handleToggleStickyExtra,
        commitHeld,
    } = useCart()
    const { isOnline } = useStats()
    const { handleLoadHistory } = useHistory()
    const { requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()
    const addressId = selectedAddress?.id

    // Active (held) item whose extras show. Mirrors the old footer's pick: explicit active
    // id, else the last held item. Computed once here (not also in MenuGrid) and passed down,
    // since both MenuGrid and useOrderOnboardingProgress below need it.
    const activeItem = cart.find(i => i.cartItemId === activeCartItemId) || cart[cart.length - 1]

    // Commit the last held item to DB when leaving the POS screen.
    // Ref keeps the unmount cleanup pointed at the latest commitHeld.
    const flushRef = useRef(commitHeld)
    flushRef.current = commitHeld
    useEffect(() => () => flushRef.current(), [])

    // OnboardingGuide is mounted once at the layout level (not per-page), so it doesn't
    // know a new order landed on its own — nudge it to re-check the "Tạo đơn" step.
    // enterKey (a submit timestamp, null until the first doSubmit) only changes on a
    // real submit, not on the initial recentOrders fetch.
    useEffect(() => { if (enterKey) requestOnboardingRefresh() }, [enterKey, requestOnboardingRefresh])

    const { hintStage, showHistoryHint, cafeSuaProductId, matchaProductId } = useOrderOnboardingProgress({
        isGuest, addressId, products, activeItem, requestOnboardingRefresh,
    })

    // Prefetch the lazy History chunk on mount so "go next" doesn't flash the Suspense
    // fallback while it loads. Same module App.jsx lazy-imports → warms the same chunk.
    useEffect(() => { import('./HistoryPage') }, [])

    const today = new Date()
    const dayName = DAY_NAMES[today.getDay()]
    const dateOnly = dateFullVN(today)

    function handleOpenHistory() {
        // Do NOT commit synchronously here: setCart([]) clears draftOrder, which repaints
        // the journal's ArrowRight for a frame before the route change lands (the "flash").
        // Just navigate — POSPage's unmount effect (flushRef) commits the held order as the
        // page leaves, so the cart (and its Check icon) stays intact until POSPage is gone.
        // handleLoadHistory's fetch resolves after that unmount flush, so its merge still
        // sees the optimistic /history row.
        navigate('/history')
        handleLoadHistory()
    }

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            <Header
                isOnline={isOnline}
                dayName={dayName}
                dateOnly={dateOnly}
                onOpenHistory={handleOpenHistory}
                addressName={selectedAddress?.name}
                onAddressClick={() => navigate(isGuest ? '/login' : '/addresses')}
                recentOrders={recentOrders}
                draftOrder={draftOrder}
                enterKey={enterKey}
                showOnboardingHint={showHistoryHint}
            />

            <MenuGrid
                products={products}
                cart={cart}
                activeItem={activeItem}
                onAddItem={handleAddItem}
                onCancelHeld={cancelHeld}
                productExtras={productExtras}
                onToggleExtra={handleToggleExtra}
                enabledStickyExtraIds={enabledStickyExtraIds}
                onToggleStickyExtra={handleToggleStickyExtra}
                hintStage={hintStage}
                cafeSuaProductId={cafeSuaProductId}
                matchaProductId={matchaProductId}
            />

            <Toast toast={toast} />
        </div>
    )
}
