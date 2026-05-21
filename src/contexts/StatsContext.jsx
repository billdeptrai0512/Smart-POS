// Today's running totals: revenue, totalCost, cupsSold, inventory snapshot.
// Backed by POSProvider — kept separate so dashboard widgets that only show
// totals don't re-render every time the cart changes.
import { createContext, useContext } from 'react'

export const StatsContext = createContext(null)

export function useStats() {
    const ctx = useContext(StatsContext)
    if (!ctx) throw new Error('useStats must be used within POSProvider')
    return ctx
}
