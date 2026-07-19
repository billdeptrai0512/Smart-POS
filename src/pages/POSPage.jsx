import { useEffect, useRef } from 'react'
import { useCart } from '../contexts/CartContext'
import { useStats } from '../contexts/StatsContext'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
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

    // Commit the last held item to DB when leaving the POS screen.
    // Ref keeps the unmount cleanup pointed at the latest commitHeld.
    const flushRef = useRef(commitHeld)
    flushRef.current = commitHeld
    useEffect(() => () => flushRef.current(), [])

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
            />

            <MenuGrid
                products={products}
                cart={cart}
                onAddItem={handleAddItem}
                onCancelHeld={cancelHeld}
                productExtras={productExtras}
                activeCartItemId={activeCartItemId}
                onToggleExtra={handleToggleExtra}
                enabledStickyExtraIds={enabledStickyExtraIds}
                onToggleStickyExtra={handleToggleStickyExtra}
            />

            <Toast toast={toast} />
        </div>
    )
}
