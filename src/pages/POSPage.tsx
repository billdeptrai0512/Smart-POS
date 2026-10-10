import { useEffect, useState } from 'react'
import { useCart } from '../contexts/CartContext'
import { useHistory } from '../contexts/HistoryContext'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useOrderOnboardingProgress } from '../hooks/useOrderOnboardingProgress'
import { useNavigate, useLocation } from 'react-router-dom'
import { DAY_NAMES } from '../constants/products'
import { dateFullVN } from '../utils/dateVN'

import Header from '../components/POSPage/Header'
import MenuGrid from '../components/POSPage/MenuGrid'
import CheckoutBar from '../components/POSPage/CheckoutBar'
import TableModal from '../components/POSPage/TableModal'
import Toast from '../components/POSPage/Toast'

export default function POSPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { isGuest } = useAuth()
    const { products, productExtras, productToppings, productDiscounts } = useProducts()
    const { addressId, selectedAddress } = useAddress()
    const {
        cart,
        handleAddItem, handleRemoveItem, handleToggleExtra, handleToggleTopping,
        toast, recentOrders, enterKey,
        enabledStickyExtraIds,
        handleToggleStickyExtra,
        handleConfirm, tableName,
        hasOrder, discountAmount, finalTotal, setItemDiscount, setItemNote,
    } = useCart()
    const { handleLoadHistory } = useHistory()

    // Dòng vừa chạm (cuối giỏ) — thanh extras sửa dòng này. Tính một lần ở đây vì cả
    // MenuGrid lẫn useOrderOnboardingProgress cần.
    const activeItem = cart[cart.length - 1]

    // "BÀN X" trong Nhật ký nhảy vào đây kèm state.openTableDetail (đọc lại ở CheckoutBar/
    // TableModal) để mở thẳng chi tiết bàn đó. location.state sống mãi qua các lần
    // mount/unmount sau đó nếu không dọn — bấm nút chọn bàn khác trên CheckoutBar sẽ vẫn
    // ăn lại state cũ này và mở nhầm bàn. Xài đúng 1 lần rồi xoá.
    useEffect(() => {
        if (location.state?.openTableDetail) navigate('/pos', { replace: true, state: null })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const { hintProductId, hintExtraName, showCheckoutHint, showHistoryHint } = useOrderOnboardingProgress({
        isGuest, addressId, products, cart, enterKey,
    })

    // Prefetch the lazy History chunk on mount so "go next" doesn't flash the Suspense
    // fallback while it loads. Same module App.tsx lazy-imports → warms the same chunk.
    useEffect(() => { import('./HistoryPage') }, [])

    const today = new Date()

    function handleOpenHistory() {
        navigate('/history/sales')
        handleLoadHistory()
    }

    // Ô cột 4 trong Header (tablet) — TableModal inline portal thẻ Mang đi vào đây.
    // State (không phải ref) để TableModal render lại khi ô đã gắn vào DOM.
    const [takeawaySlot, setTakeawaySlot] = useState<HTMLDivElement | null>(null)

    // Tablet/foldable (biến thể dine-split, xem index.css): chia đôi
    // màn hình — bên trái vẫn là POS như trên điện thoại, bên phải là lưới chọn bàn
    // luôn hiện (TableModal inline) thay vì phải bấm mở modal, và "Tạo đơn" nằm
    // ngay dưới lưới đó thay vì dưới menu — đỡ một cú liếc chéo cột lúc chốt đơn.
    // .pos-dine-grid (index.css) xếp 3 vùng: left (menu, y hệt điện thoại) | table |
    // checkout — CheckoutBar CHỈ MOUNT MỘT LẦN, "nhảy" chỗ qua grid-area theo
    // breakpoint thay vì phải render 2 bản (2 bản = 2 state độc lập, gập/mở
    // Samsung Z Fold giữa lúc sửa giảm giá là mất thao tác dở dang).
    return (
        <div className="pos-dine-grid h-full">
            {/* Header phủ cả 2 cột ở dine-split (4 cột bên trong, xem Header.tsx). */}
            <div className="[grid-area:header] w-full max-w-lg mx-auto dine-split:max-w-none">
                <Header
                    dayName={DAY_NAMES[today.getDay()]}
                    dateOnly={dateFullVN(today)}
                    onOpenHistory={handleOpenHistory}
                    addressName={selectedAddress?.name}
                    onAddressClick={() => navigate(isGuest ? '/login' : '/addresses')}
                    recentOrders={recentOrders}
                    enterKey={enterKey}
                    showOnboardingHint={showHistoryHint}
                    takeawaySlotRef={setTakeawaySlot}
                />
            </div>

            <div className="[grid-area:left] flex flex-col h-full min-h-0 w-full max-w-lg mx-auto bg-bg dine-split:max-w-none dine-split:mx-0 dine-split:border-r dine-split:border-border/80">
                <MenuGrid
                    products={products}
                    cart={cart}
                    activeItem={activeItem}
                    onAddItem={handleAddItem}
                    onRemoveItem={handleRemoveItem}
                    productExtras={productExtras}
                    productToppings={productToppings}
                    productDiscounts={productDiscounts}
                    onToggleExtra={handleToggleExtra}
                    onToggleTopping={handleToggleTopping}
                    enabledStickyExtraIds={enabledStickyExtraIds}
                    onToggleStickyExtra={handleToggleStickyExtra}
                    hintProductId={hintProductId}
                    hintExtraName={hintExtraName}
                />

                <Toast toast={toast} />
            </div>

            <div className="pos-table-pane hidden dine-split:flex flex-col min-h-0 [grid-area:table] bg-bg">
                <TableModal inline takeawaySlot={takeawaySlot} />
            </div>

            <div className="[grid-area:checkout] w-full max-w-lg mx-auto dine-split:max-w-none">
                <CheckoutBar
                    discountAmount={discountAmount}
                    finalTotal={finalTotal}
                    cart={cart}
                    onItemDiscount={setItemDiscount}
                    tableName={tableName}
                    onConfirm={handleConfirm}
                    onItemNote={setItemNote}
                    disabled={!hasOrder}
                    showOnboardingHint={showCheckoutHint}
                />
            </div>
        </div>
    )
}
