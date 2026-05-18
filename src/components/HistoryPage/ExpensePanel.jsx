import { useMemo } from 'react'
import { formatVND, formatVNDInput } from '../../utils'
import { ingredientLabel, getIngredientUnit } from '../common/recipeUtils'

const FILTER_MENU = [
    { key: 'operation', label: 'Vận hành' },
    { key: 'nvl', label: 'Tồn kho' },
    { key: 'fixed', label: 'Cố định' },
]

function getExpenseBadge(e) {
    if (e.is_refill && !e.metadata?.free_form) return { main: 'Tồn kho', sub: null, cls: 'bg-primary/10 text-primary' }
    if (e.is_refill && e.metadata?.free_form) return { main: 'Vận hành', sub: 'Sau ca', cls: 'bg-danger/10 text-danger' }
    return { main: 'Vận hành', sub: 'Trong ca', cls: 'bg-danger/10 text-danger' }
}

function formatTime(iso) {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function ExpensePanel({
    isReadOnly, isLoading,
    expenseFilter, onSelectFilter,
    isManager, fixedCosts,
    editingFixedId, editFixedName, editFixedAmount, deletingFixedId,
    onStartEditFixed, onCancelEditFixed, onSubmitEditFixed,
    onEditFixedNameChange, onEditFixedAmountChange, onDeleteFixed,
    fixedPayments, filteredExpenses, ingredientUnits, nvlStockSnapshot,
    deletingExpId, onDeleteExpense,
}) {
    return (
        <main className="flex-1 overflow-y-auto px-4 py-4 pb-4 space-y-3 bg-bg">
            {/* Pill tab filter — same style as ReportViewFilter */}
            <div className="bg-surface border border-border/60 rounded-[14px] p-1 shadow-sm flex gap-1">
                {FILTER_MENU.map(f => {
                    const active = expenseFilter === f.key
                    return (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => onSelectFilter(f.key)}
                            className={`flex-1 py-2 rounded-[10px] text-[11px] font-black uppercase tracking-wider transition-all duration-150
                                ${active
                                    ? 'bg-danger text-bg font-bold shadow-sm'
                                    : 'text-text-secondary hover:text-text hover:bg-surface-light'
                                }`}
                        >
                            {f.label}
                        </button>
                    )
                })}
            </div>

            {isManager && expenseFilter === 'fixed' && (
                <FixedCostsSection
                    isReadOnly={isReadOnly}
                    fixedCosts={fixedCosts}
                    editingFixedId={editingFixedId}
                    editFixedName={editFixedName}
                    editFixedAmount={editFixedAmount}
                    deletingFixedId={deletingFixedId}
                    onStartEdit={onStartEditFixed}
                    onCancelEdit={onCancelEditFixed}
                    onSubmitEdit={onSubmitEditFixed}
                    onNameChange={onEditFixedNameChange}
                    onAmountChange={onEditFixedAmountChange}
                    onDelete={onDeleteFixed}
                />
            )}

            {expenseFilter === 'fixed' && fixedPayments.length > 0 && (
                <FixedPaymentsSection
                    payments={fixedPayments}
                    isReadOnly={isReadOnly}
                    deletingExpId={deletingExpId}
                    onDelete={onDeleteExpense}
                />
            )}

            {isLoading ? (
                <div className="flex flex-col gap-3 animate-pulse">
                    <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                    <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                </div>
            ) : filteredExpenses.length === 0 ? (
                expenseFilter !== 'fixed' && (
                    <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                        Chưa có chi phí nào.
                    </div>
                )
            ) : (
                <ExpenseList
                    expenses={filteredExpenses}
                    showRunning={expenseFilter === 'operation' || expenseFilter === 'nvl'}
                    isReadOnly={isReadOnly}
                    ingredientUnits={ingredientUnits}
                    nvlStockSnapshot={nvlStockSnapshot}
                    deletingExpId={deletingExpId}
                    onDeleteExpense={onDeleteExpense}
                />
            )}
        </main>
    )
}

function FixedCostsSection({
    isReadOnly, fixedCosts,
    editingFixedId, editFixedName, editFixedAmount, deletingFixedId,
    onStartEdit, onCancelEdit, onSubmitEdit, onNameChange, onAmountChange, onDelete,
}) {
    return (
        <div className="bg-surface border border-warning/20 rounded-[20px] p-4 shadow-sm flex flex-col gap-3">
            <span className="text-[11px] font-black text-warning uppercase tracking-wider">Chi phí cố định</span>
            {(!fixedCosts || fixedCosts.length === 0) ? (
                <span className="text-[13px] text-text-secondary text-center py-2">Chưa có chi phí cố định.</span>
            ) : (
                <div className="flex flex-col gap-2">
                    {fixedCosts.map(fc => (
                        <div key={fc.id} className="flex flex-col gap-2 border-b border-border/30 pb-2 last:border-0 last:pb-0">
                            {editingFixedId === fc.id ? (
                                <div className="flex flex-col gap-2">
                                    <input
                                        type="text"
                                        value={editFixedName}
                                        onChange={e => onNameChange(e.target.value)}
                                        className="bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[14px] font-medium text-text focus:outline-none focus:border-warning/40"
                                        autoFocus
                                    />
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={editFixedAmount}
                                            onChange={e => onAmountChange(formatVNDInput(e.target.value))}
                                            className="flex-1 bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[14px] font-medium text-text focus:outline-none focus:border-warning/40"
                                        />
                                        <button onClick={onSubmitEdit} className="px-4 py-2 rounded-[10px] bg-warning text-white text-[13px] font-black">Lưu</button>
                                        <button onClick={onCancelEdit} className="px-3 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-[13px] font-bold">Hủy</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-[14px] font-medium text-text">{fc.name}</span>
                                        <span className="text-[13px] font-black text-warning tabular-nums">-{formatVND(fc.amount)}</span>
                                    </div>
                                    {!isReadOnly && (
                                        <div className="flex items-center gap-3">
                                            <span onClick={() => onStartEdit(fc)} className="text-primary text-[13px] font-bold cursor-pointer hover:text-primary/80 select-none">Sửa</span>
                                            <span
                                                onClick={() => {
                                                    if (deletingFixedId === fc.id) return
                                                    if (window.confirm(`Xóa chi phí cố định "${fc.name}"?\n\nChi phí này sẽ không còn được tính vào các ca sau.`)) {
                                                        onDelete(fc.id)
                                                    }
                                                }}
                                                className="text-danger text-[13px] font-bold cursor-pointer hover:text-danger/80 select-none"
                                            >
                                                {deletingFixedId === fc.id ? '⏳' : 'Xóa'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function FixedPaymentsSection({ payments, isReadOnly, deletingExpId, onDelete }) {
    return (
        <div className="flex flex-col gap-2">
            <span className="text-[11px] font-black text-text-secondary uppercase tracking-wider px-1">Đã thanh toán trong kỳ</span>
            {payments.map(expense => {
                const time = formatTime(expense.created_at)
                return (
                    <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                        <div className="absolute top-0 right-0 px-2 py-1 rounded-bl-[14px] flex flex-col items-end leading-tight bg-warning/10 text-warning">
                            <span className="text-[10px] font-black uppercase tracking-wider">Cố định</span>
                            <span className="text-[9px] font-medium opacity-70 normal-case">Thực chi</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-black text-[14px] mt-1 text-warning">-{formatVND(expense.amount)}</span>
                        </div>
                        <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                            <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                                <span className="text-text-dim text-[10px] italic leading-tight">Đã phân bổ hàng ngày — không trừ kép vào lợi nhuận</span>
                                {expense.staff_name && <span className="text-text-secondary/70 text-[12px] font-bold leading-none">{expense.staff_name}</span>}
                            </div>
                            <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                {isReadOnly ? (
                                    <span className="text-text-dim text-[14px] font-bold">{time}</span>
                                ) : (
                                    <span
                                        className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none leading-none"
                                        onClick={() => {
                                            if (deletingExpId === expense.id) return
                                            if (window.confirm(`Xóa ghi nhận thực chi "${expense.name}"?\n\nHành động này không thể hoàn tác!`)) {
                                                onDelete(expense.id, expense.amount)
                                            }
                                        }}
                                    >
                                        {deletingExpId === expense.id ? '⏳' : time}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// Subcomponent that owns the running-total computation so it
// doesn't rerun when unrelated state changes in ExpensePanel.
function ExpenseList({ expenses, showRunning, isReadOnly, ingredientUnits, nvlStockSnapshot, deletingExpId, onDeleteExpense }) {
    // Walk oldest → newest (expenses are sorted newest-first) to accumulate
    const runningMap = useMemo(() => {
        const map = new Map()
        let cum = 0
        for (let i = expenses.length - 1; i >= 0; i--) {
            cum += expenses[i].amount || 0
            map.set(expenses[i].id, cum)
        }
        return map
    }, [expenses])

    return (
        <>
            {expenses.map(expense => (
                <ExpenseCard
                    key={expense.id}
                    expense={expense}
                    isReadOnly={isReadOnly}
                    ingredientUnits={ingredientUnits}
                    snap={nvlStockSnapshot.get(expense.id)}
                    runningTotal={showRunning ? runningMap.get(expense.id) : null}
                    deletingExpId={deletingExpId}
                    onDelete={onDeleteExpense}
                />
            ))}
        </>
    )
}

function ExpenseCard({ expense, isReadOnly, ingredientUnits, snap, runningTotal, deletingExpId, onDelete }) {
    const badge = getExpenseBadge(expense)
    const time = formatTime(expense.created_at)
    const isNvlWithMeta = expense.is_refill && !expense.metadata?.free_form && expense.metadata?.ingredient
    const ingKey = isNvlWithMeta ? expense.metadata.ingredient : null
    const qty = isNvlWithMeta ? Number(expense.metadata?.qty) || 0 : 0
    const unit = ingKey ? getIngredientUnit(ingKey, undefined, ingredientUnits) : ''

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
            {/* <div className={`absolute top-0 right-0 px-2 py-1 rounded-bl-[14px] flex flex-col items-end leading-tight ${badge.cls}`}>
                <span className="text-[10px] font-black uppercase tracking-wider">{badge.sub}</span>
                {badge.sub && <span className="text-[9px] font-medium opacity-70 normal-case">{badge.sub}</span>}
            </div> */}
            <div className="flex justify-between items-center mb-1">
                <span className="font-black text-[14px] mt-1 text-warning">
                    -{formatVND(expense.amount)}
                </span>
                {runningTotal != null && (
                    <span className="text-danger leading-none text-[14px] font-bold tabular-nums">
                        -{formatVND(runningTotal)}
                    </span>
                )}
            </div>
            <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                <div className="flex flex-col flex-1 gap-1.5 mt-0.5">
                    {isNvlWithMeta ? (
                        <div className="flex flex-col gap-2 items-start w-full">
                            <span className={`text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text ${expense.deletedAt ? 'line-through' : ''}`}>{ingredientLabel(ingKey)}</span>
                            {/* Snap = running balance (preferred); fallback = qty + đơn giá nhập so audit
                                always sees how much came in and at what price, even without snapshot data. */}
                            {snap ? (
                                <span className="text-text text-[13px] font-medium whitespace-nowrap tabular-nums">
                                    {Math.round(snap.before * 10) / 10} {unit} {qty > 0 ? '+' : ''} {qty} {unit} → {Math.round(snap.after * 10) / 10} {unit}
                                </span>
                            ) : qty > 0 && (
                                <span className="text-text-secondary text-[12px] font-bold whitespace-nowrap tabular-nums">
                                    +{qty.toLocaleString('vi-VN')} {unit}
                                    {expense.amount > 0 && (
                                        <span className="text-text-dim font-medium"> · {Math.round(expense.amount / qty).toLocaleString('vi-VN')}đ/{unit}</span>
                                    )}
                                </span>
                            )}
                        </div>

                    ) : (
                        <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                    )}
                    {expense.staff_name && (
                        <span className="text-text-secondary/70 text-[12px] font-bold leading-none mt-2">{expense.staff_name}</span>
                    )}
                </div>
                <div className="flex flex-col justify-end items-end gap-1 shrink-0 mt-0.5">
                    {/* {runningTotal != null && (
                        <span className="text-danger leading-none text-[14px] font-bold tabular-nums">
                            -{formatVND(runningTotal)}
                        </span>
                    )} */}
                    {isReadOnly ? (
                        <span className="text-text-dim text-[14px] font-bold leading-none">{time}</span>
                    ) : (
                        <span
                            className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none leading-none"
                            onClick={() => {
                                if (deletingExpId === expense.id) return
                                if (window.confirm(`Xóa chi phí "${expense.name}"?\n\nHành động này không thể hoàn tác!`)) {
                                    onDelete(expense.id, expense.amount)
                                }
                            }}
                        >
                            {deletingExpId === expense.id ? '⏳' : time}
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}
