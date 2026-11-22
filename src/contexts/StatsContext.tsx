// Trạng thái mạng + retry đồng bộ offline.
// Backed by POSProvider — kept separate so dashboard widgets that only show
// totals don't re-render every time the cart changes.
import { createContext, useContext } from 'react'

export interface StatsContextValue {
    isOnline: boolean
    retrySync: () => Promise<void>
}

export const StatsContext = createContext<StatsContextValue | null>(null)

export function useStats() {
    const ctx = useContext(StatsContext)
    if (!ctx) throw new Error('useStats must be used within POSProvider')
    return ctx
}
