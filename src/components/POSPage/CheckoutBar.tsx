import { useState } from 'react'
import { flushSync } from 'react-dom'
import { Armchair, ChevronUp } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { formatVND } from '../../utils'
import { onboardingHintClass } from '../../utils/onboardingHint'
import TableModal from './TableModal'
import CartListModal from './CartListModal'
import type { CartItem, Discount, UUID } from '../../types/domain'

// Thanh chốt bàn: giỏ chỉ thành đơn khi bấm Tạo đơn ở đây.
// Giảm giá / Ghi chú từng món mở từ việc chạm vào số Tổng (CartListModal).
interface Props {
    discountAmount: number
    finalTotal: number
    cart: CartItem[]
    onItemDiscount: (cartItemId: UUID, discount: Discount) => void
    onItemNote: (cartItemId: UUID, note: string | null) => void
    tableName: string
    onConfirm: (discountAmount: number, tableName: string) => void
    disabled?: boolean
    showOnboardingHint?: boolean
}

export default function CheckoutBar({
    discountAmount, finalTotal,
    cart, onItemDiscount, onItemNote,
    tableName, onConfirm, disabled, showOnboardingHint = false,
}: Props) {
    // "BÀN 3" trong Nhật ký nhảy tới /pos kèm state này — mở thẳng lưới bàn (TableModal
    // tự đọc lại state này để seed "detail" cho đúng bàn đó, xem TableModal.tsx).
    const { state } = useLocation()
    const [showCart, setShowCart] = useState(false)
    // Ở dine-split, lưới bàn (.pos-table-pane, xem POSPage.tsx) đã hiện sẵn — hỏi thẳng DOM thay vì chép lại breakpoint.
    const tablePaneShown = () => { const p = document.querySelector('.pos-table-pane'); return !!p && getComputedStyle(p).display !== 'none' }
    const [showTables, setShowTables] = useState(!!state?.openTableDetail)

    return (
        <footer className="shrink-0 bg-surface border-t border-border/80 px-6 dine-split:px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-4">
                <button
                    type="button"
                    onClick={() => flushSync(() => setShowCart(true))}
                    disabled={disabled}
                    aria-label="Giảm giá và ghi chú"
                    className="min-w-0 flex-1 flex flex-col gap-0.5 text-left disabled:cursor-not-allowed"
                >
                    {/* Bàn đứng trên số tiền, có icon + màu chữ chính: biết đơn đi bàn nào là điều cần thấy trước khi bấm Tạo đơn.
                        Một dòng riêng để màn hẹp không cắt tên. Ẩn ở dine-split: lưới bàn đã hiện sẵn bên cạnh. */}
                    {tableName && (
                        <span className="flex dine-split:hidden items-center gap-1.5 min-w-0">
                            <Armchair size={13} strokeWidth={2.5} className="shrink-0 text-primary" />
                            <span className="truncate text-[13px] font-black text-text">{tableName}</span>
                        </span>
                    )}
                    <span className="flex items-baseline gap-2">
                        <span className="text-[14px] font-black uppercase tracking-wider text-text-secondary">Tổng:</span>
                        <span className="text-[17px] font-black text-text tabular-nums">{formatVND(finalTotal)}</span>
                        {!disabled && <ChevronUp size={14} strokeWidth={3} className="self-center text-text-secondary" />}
                    </span>
                </button>
                <button
                    onClick={() => onConfirm(discountAmount, tableName)}
                    disabled={disabled}
                    className={`w-[45%] min-w-[132px] max-w-[192px] shrink-0 py-2.5 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase tracking-wider hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${onboardingHintClass(showOnboardingHint, 'solid')}`}
                >
                    Tạo đơn
                </button>
            </div>

            {showCart && (
                <CartListModal cart={cart} onClose={() => setShowCart(false)} onItemDiscount={onItemDiscount} onItemNote={onItemNote} onConfirm={() => { onConfirm(discountAmount, tableName); setShowCart(false) }} tableName={tableName} onPickTable={tablePaneShown() ? undefined : () => setShowTables(true)} />
            )}

            {showTables && <TableModal onClose={() => setShowTables(false)} backLabel={showCart ? 'Giỏ hàng' : undefined} />}
        </footer>
    )
}
