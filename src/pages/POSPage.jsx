import { useEffect, useRef } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { DAY_NAMES } from '../constants'

import Header from '../components/POSPage/Header'
import MenuGrid from '../components/POSPage/MenuGrid'
import OrderFooter from '../components/POSPage/OrderFooter'
import Toast from '../components/POSPage/Toast'

export default function POSPage() {
    const navigate = useNavigate()
    const { isGuest } = useAuth()
    const { products, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const {
        cart, activeCartItemId,
        handleAddItem, cancelHeld, handleToggleExtra,
        isOnline,
        toast, handleLoadHistory, recentOrders, draftOrder, enterKey,
        enabledStickyExtraIds,
        handleToggleStickyExtra,
        commitHeld,
    } = usePOS()

    // Commit the last held item to DB when leaving the POS screen.
    // Ref keeps the unmount cleanup pointed at the latest commitHeld.
    const flushRef = useRef(commitHeld)
    flushRef.current = commitHeld
    useEffect(() => () => flushRef.current(), [])

    const today = new Date()
    const dayName = DAY_NAMES[today.getDay()]
    const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

    function handleOpenHistory() {
        handleLoadHistory()
        navigate('/history')
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
                onCommitHeld={commitHeld}
            />

            <OrderFooter
                cart={cart}
                activeCartItemId={activeCartItemId}
                onToggleExtra={handleToggleExtra}
                productExtras={productExtras}
                enabledStickyExtraIds={enabledStickyExtraIds}
                onToggleStickyExtra={handleToggleStickyExtra}
            />

            <Toast toast={toast} />
        </div>
    )
}
