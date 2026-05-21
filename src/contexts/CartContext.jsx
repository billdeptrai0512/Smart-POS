// Cart slice of the POS state. Backed by POSProvider — re-renders only when
// cart-related values change (cart, active item, sticky extras, totals,
// submission status, last order, online indicator).
import { createContext, useContext } from 'react'

export const CartContext = createContext(null)

export function useCart() {
    const ctx = useContext(CartContext)
    if (!ctx) throw new Error('useCart must be used within POSProvider')
    return ctx
}
