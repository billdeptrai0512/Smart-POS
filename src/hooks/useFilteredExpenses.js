import { useMemo } from 'react'

// Apply the HistoryPage expense-tab filter to a list of non-fixed expenses.
// Filter values:
//   daily     — chỉ chi phí vận hành trong ca (không refill)
//   after     — chỉ refill free-form sau ca
//   operation — daily + after (toàn bộ vận hành)
//   nvl       — refill nguyên vật liệu (không free-form)
//   fixed     — không có item nào (panel cố định render từ nguồn khác)
//   * any other value falls through unchanged
// Output is sorted newest-first.
export function useFilteredExpenses(nonFixedExpenses, expenseFilter) {
    return useMemo(() => {
        let list = nonFixedExpenses
        if (expenseFilter === 'daily') list = list.filter(e => !e.is_refill)
        else if (expenseFilter === 'after') list = list.filter(e => e.is_refill && e.metadata?.free_form)
        else if (expenseFilter === 'operation') list = list.filter(e => !e.is_refill || (e.is_refill && e.metadata?.free_form))
        else if (expenseFilter === 'nvl') list = list.filter(e => e.is_refill && !e.metadata?.free_form)
        else if (expenseFilter === 'fixed') list = []
        return [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }, [nonFixedExpenses, expenseFilter])
}
