// Today's orders / expenses / fixed costs + their mutation handlers.
// Backed by POSProvider — kept separate so /pos doesn't re-render when the
// /history page mutates expense state.
import { createContext, useContext } from 'react'

export const HistoryContext = createContext(null)

export function useHistory() {
    const ctx = useContext(HistoryContext)
    if (!ctx) throw new Error('useHistory must be used within POSProvider')
    return ctx
}
