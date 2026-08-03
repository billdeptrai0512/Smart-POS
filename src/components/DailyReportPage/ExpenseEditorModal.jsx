import { useCallback, useEffect, useState } from 'react'
import AddExpenseModal from '../HistoryPage/AddExpenseModal'
import { useHistory } from '../../contexts/HistoryContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useCart } from '../../contexts/CartContext'
import { parseVNDInput, formatVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'
import {
    fetchExpenseCategories, insertExpenseCategory, updateExpenseCategory,
    deleteExpenseCategory, fetchExpensesByCategory, fetchExpenseCategoryCounts, restoreExpenseCategory,
} from '../../services/expenseService'

/**
 * Modal SỬA 1 chi phí, dùng ngay tại chỗ trong báo cáo Dòng tiền (bấm 1 dòng
 * trong panel Thực chi). Tự ôm state form + CRUD nhãn nên trang gọi chỉ cần
 * truyền expense + onSaved — không phải điều hướng sang tab Chi phí.
 *
 * Chỉ SỬA, không tạo mới: nút "+" tạo chi phí vẫn nằm ở tab Chi phí.
 *
 * onSaved(id, updates | null): null = đã xoá. Trang gọi tự patch list của mình
 * (scope quá khứ đọc từ RPC báo cáo, không tự cập nhật theo context).
 */
export default function ExpenseEditorModal({ expense, addressId, onSaved, onClose }) {
    const { handleUpdateExpense, handleDeleteExpense } = useHistory()
    const confirm = useConfirm()
    const { showToast } = useCart()

    const [costName, setCostName] = useState(expense.name || '')
    const [costAmount, setCostAmount] = useState(() => formatVNDInput(String(expense.amount ?? '')))
    const [expenseDate, setExpenseDate] = useState(() => dateStringVN(new Date(expense.created_at)))
    const [isAfterShift, setIsAfterShift] = useState(!!expense.metadata?.free_form)
    const [paymentMethod, setPaymentMethod] = useState(expense.payment_method || 'cash')
    const [selectedCategoryId, setSelectedCategoryId] = useState(expense.category_id || null)
    const [expenseCategories, setExpenseCategories] = useState([])
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        if (!addressId) return
        fetchExpenseCategories(addressId).then(setExpenseCategories)
    }, [addressId])

    const handleCreateCategory = useCallback(async ({ name, group_section }) => {
        if (!addressId) return null
        const created = await insertExpenseCategory(addressId, { name, group_section })
        setExpenseCategories(prev => [...prev, created])
        return created
    }, [addressId])

    const handleUpdateCategory = useCallback(async (id, updates) => {
        const updated = await updateExpenseCategory(id, updates)
        setExpenseCategories(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
        return updated
    }, [])

    const handleDeleteCategoryTag = useCallback(async (id) => {
        await deleteExpenseCategory(id)
        setExpenseCategories(prev => prev.filter(c => c.id !== id))
    }, [])

    const handleRestoreCategory = useCallback(async (category) => {
        await restoreExpenseCategory(category.id)
        setExpenseCategories(prev => prev.some(c => c.id === category.id) ? prev : [...prev, category])
    }, [])

    const handleMoveExpense = useCallback(async (expenseId, toId) => {
        await handleUpdateExpense(expenseId, { category_id: toId })
        onSaved?.(expenseId, { category_id: toId })
    }, [handleUpdateExpense, onSaved])

    const submit = async () => {
        const amount = parseVNDInput(costAmount)
        if (amount <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            // Chỉ đổi created_at khi NGÀY khác ngày gốc (giữ giờ gốc nếu cùng ngày).
            const sameDay = dateStringVN(new Date(expense.created_at)) === expenseDate
            const updates = {
                name: costName.trim(),
                amount,
                payment_method: paymentMethod,
                category_id: selectedCategoryId || null,
                created_at: sameDay ? expense.created_at : new Date(`${expenseDate}T12:00:00+07:00`).toISOString(),
                is_refill: !!isAfterShift,
                metadata: isAfterShift ? { free_form: true } : {},
            }
            await handleUpdateExpense(expense.id, updates)
            onSaved?.(expense.id, updates)
            onClose()
        } catch { /* lỗi đã surface qua toast của context */ }
        finally { setIsSubmitting(false) }
    }

    const remove = async () => {
        if (!await confirm({ title: `Xóa chi phí "${expense.name}"?`, detail: 'Hành động này không thể hoàn tác!', danger: true, confirmLabel: 'Xóa' })) return
        await handleDeleteExpense(expense.id, expense.amount)
        onSaved?.(expense.id, null)
        onClose()
    }

    return (
        <AddExpenseModal
            isEditing
            onDelete={remove}
            expenseCategory="expense"
            onCategoryChange={() => {}}
            costName={costName}
            costAmount={costAmount}
            isSubmitting={isSubmitting}
            isAfterShift={isAfterShift}
            onAfterShiftChange={setIsAfterShift}
            expenseCategories={expenseCategories}
            selectedCategoryId={selectedCategoryId}
            onCategoryIdChange={setSelectedCategoryId}
            onCreateCategory={handleCreateCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategoryTag}
            onListCategoryExpenses={(id) => fetchExpensesByCategory(addressId, id)}
            onMoveExpense={handleMoveExpense}
            onCountCategories={() => fetchExpenseCategoryCounts(addressId)}
            onRestoreCategory={handleRestoreCategory}
            showToast={showToast}
            onClose={onClose}
            onSubmit={submit}
            onNameChange={setCostName}
            onAmountChange={setCostAmount}
            expenseDate={expenseDate}
            onDateChange={setExpenseDate}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
        />
    )
}
