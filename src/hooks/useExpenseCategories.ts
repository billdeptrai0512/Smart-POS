import { useEffect, useMemo, useState } from 'react'
import {
    fetchExpenseCategories, insertExpenseCategory, updateExpenseCategory,
    deleteExpenseCategory, fetchExpensesByCategory, fetchExpenseCategoryCounts, restoreExpenseCategory,
} from '../services/expenseService'
import type { ExpenseCategory, UUID } from '../types/domain'

/**
 * Nhãn chi phí của một địa chỉ + các thao tác CRUD (đúng tên prop của AddExpenseModal để `{...actions}`).
 * `refreshKey` đổi → tải lại (vd. mỗi lần mở modal thêm chi phí).
 */
export function useExpenseCategories(addressId: UUID | null | undefined, refreshKey?: unknown) {
    const [categories, setCategories] = useState<ExpenseCategory[]>([])

    useEffect(() => {
        if (!addressId) return
        fetchExpenseCategories(addressId).then(setCategories)
    }, [addressId, refreshKey])

    const actions = useMemo(() => ({
        onCreateCategory: async ({ name, group_section }: { name: string; group_section: string }) => {
            if (!addressId) return null
            const created = await insertExpenseCategory(addressId, { name, group_section })
            setCategories(prev => [...prev, created])
            return created
        },
        onUpdateCategory: async (id: UUID, updates: { name?: string; group_section?: string }) => {
            const updated = await updateExpenseCategory(id, updates)
            setCategories(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
            return updated
        },
        // Soft-delete nhãn RỖNG. Sheet liệt kê chi phí của nhãn trước — nhãn còn chi phí phải chuyển từng dòng
        // sang nhãn khác trước khi tới đây, để không âm thầm dồn vào "Chi phí khác".
        onDeleteCategory: async (id: UUID) => {
            await deleteExpenseCategory(id)
            setCategories(prev => prev.filter(c => c.id !== id))
        },
        onListCategoryExpenses: (id: UUID) => fetchExpensesByCategory(addressId, id),
        onCountCategories: () => fetchExpenseCategoryCounts(addressId),
        // Hoàn tác xoá nhãn: bật lại is_active + đưa lại vào danh sách (việc trả chi phí về nhãn cũ do sheet lo).
        onRestoreCategory: async (category: ExpenseCategory) => {
            await restoreExpenseCategory(category.id)
            setCategories(prev => prev.some(c => c.id === category.id) ? prev : [...prev, category])
        },
    }), [addressId])

    return { categories, actions }
}
