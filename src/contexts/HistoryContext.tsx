// Today's orders / expenses / fixed costs + their mutation handlers.
// Backed by POSProvider — kept separate so /pos doesn't re-render when the
// /history page mutates expense state.
import { createContext, useContext } from 'react'
import type { Row, UUID } from '../types/domain'

export interface HistoryContextValue {
    todayOrders: Row[]
    todayExpenses: Row[]
    isLoadingHistory: boolean
    justArrivedIds: Set<UUID>
    /** false = tải hỏng (khác "không có đơn"); undefined = bỏ qua vì vừa tải xong / đang tải. */
    handleLoadHistory: () => Promise<boolean | undefined>
    handleDeleteOrder: (orderId: UUID) => Promise<boolean>
    handleUpdateOrderDiscount: (orderId: UUID, total: number, discountAmount: number, itemDiscounts?: { id: UUID; discount_amount: number }[]) => Promise<void>
    handleAddExpense: (
        name: string, amount: number, isRefill?: boolean, paymentMethod?: string, metadata?: Row, isFixed?: boolean,
        categoryId?: UUID | null, createdAt?: string | null,
    ) => Promise<Row | undefined>
    handleUpdateExpense: (expenseId: UUID, updates: Row) => Promise<Row>
    handleDeleteExpense: (expenseId: UUID, amount: number) => Promise<void>
    refreshTodayExpenses: () => Promise<void>
    userRole: string
}

export const HistoryContext = createContext<HistoryContextValue | null>(null)

export function useHistory() {
    const ctx = useContext(HistoryContext)
    if (!ctx) throw new Error('useHistory must be used within POSProvider')
    return ctx
}
