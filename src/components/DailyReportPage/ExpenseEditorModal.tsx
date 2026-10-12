import { useCallback, useState } from 'react'
import AddExpenseModal from '../HistoryPage/AddExpenseModal'
import type { Row, UUID } from '../../types/domain'
import { useHistory } from '../../contexts/HistoryContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useCart } from '../../contexts/CartContext'
import { parseVNDInput, formatVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'
import { useExpenseCategories } from '../../hooks/useExpenseCategories'
import { buildExpenseUpdates } from '../../utils/expenseUpdates'

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
interface Props {
    expense: Row
    addressId: UUID | null | undefined
    onSaved?: (id: UUID, updates: Row | null) => void
    onClose: () => void
}

export default function ExpenseEditorModal({ expense, addressId, onSaved, onClose }: Props) {
    const { handleUpdateExpense, handleDeleteExpense } = useHistory()
    const confirm = useConfirm()
    const { showToast } = useCart()

    const [costName, setCostName] = useState(expense.name || '')
    const [costAmount, setCostAmount] = useState(() => formatVNDInput(String(expense.amount ?? '')))
    const [expenseDate, setExpenseDate] = useState(() => dateStringVN(new Date(expense.created_at)))
    const [isAfterShift, setIsAfterShift] = useState(!!expense.metadata?.free_form)
    const [paymentMethod, setPaymentMethod] = useState(expense.payment_method || 'cash')
    const [selectedCategoryId, setSelectedCategoryId] = useState<UUID | null>(expense.category_id || null)
    const { categories: expenseCategories, actions: categoryActions } = useExpenseCategories(addressId)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleMoveExpense = useCallback(async (expenseId: UUID, toId: UUID) => {
        await handleUpdateExpense(expenseId, { category_id: toId })
        onSaved?.(expenseId, { category_id: toId })
    }, [handleUpdateExpense, onSaved])

    const submit = async () => {
        const amount = parseVNDInput(costAmount)
        if (amount <= 0 || !costName.trim()) return
        setIsSubmitting(true)
        try {
            const updates = buildExpenseUpdates(expense, {
                name: costName, amount, paymentMethod, categoryId: selectedCategoryId, date: expenseDate, isAfterShift,
            })
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
            costName={costName}
            costAmount={costAmount}
            isSubmitting={isSubmitting}
            isAfterShift={isAfterShift}
            onAfterShiftChange={setIsAfterShift}
            expenseCategories={expenseCategories}
            selectedCategoryId={selectedCategoryId}
            onCategoryIdChange={setSelectedCategoryId}
            {...categoryActions}
            onMoveExpense={handleMoveExpense}
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
