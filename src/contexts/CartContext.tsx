// Cart slice of the POS state. Backed by POSProvider — re-renders only when
// cart-related values change (cart, active item, sticky extras, totals,
// submission status, last order, online indicator).
import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type { CartExtra, CartItem, CartTopping, Discount, Row, UUID } from '../types/domain'
import type { OpenTable, TableRound } from '../services/orderService'
import type { LastOrder } from '../services/cartOps'
import type { useToast } from '../hooks/useToast'

export interface CartContextValue extends ReturnType<typeof useToast> {
    cart: CartItem[]
    handleAddItem: (product: Row) => void
    handleRemoveItem: (product: Row) => void
    handleToggleExtra: (extra: CartExtra) => void
    handleToggleStickyExtra: (extra: CartExtra) => void
    handleToggleTopping: (topping: CartTopping) => void
    reopenRoundIntoCart: (round: Row) => Promise<boolean>
    setItemDiscount: (cartItemId: UUID, discount: Discount) => void
    setItemNote: (cartItemId: UUID, note: string | null) => void
    handleConfirm: (discountAmount: number, tableName: string) => void
    tableName: string
    setTableName: Dispatch<SetStateAction<string>>
    openTables: OpenTable[]
    refreshTables: () => Promise<OpenTable[]>
    handleCloseTable: (table: OpenTable, opts?: { printFailed?: boolean }) => Promise<void>
    toggleMark: (round: TableRound, key: 'servedAt' | 'paidAt') => Promise<void>
    moveTableRounds: (orderIds: UUID[], targetTableName: string | null) => Promise<void>
    enabledStickyExtraIds: string[]
    total: number
    orderCount: number
    hasOrder: boolean
    discountAmount: number
    finalTotal: number
    recentOrders: LastOrder[]
    enterKey: string | null
}

export const CartContext = createContext<CartContextValue | null>(null)

export function useCart() {
    const ctx = useContext(CartContext)
    if (!ctx) throw new Error('useCart must be used within POSProvider')
    return ctx
}
