import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatVND, formatVNDInput, parseVNDInput } from '../../utils'

export default function ExpenseModal({ todayExpenses, onClose, onAddExpense, onDeleteExpense, fixedCosts, onAddFixedCost, onUpdateFixedCost, onDeleteFixedCost, userRole }) {
    const navigate = useNavigate()
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deletingId, setDeletingId] = useState(null)

    // Fixed cost form state
    const [fixedName, setFixedName] = useState('')
    const [fixedAmount, setFixedAmount] = useState('')
    const [isFixedSubmitting, setIsFixedSubmitting] = useState(false)
    const [deletingFixedId, setDeletingFixedId] = useState(null)
    const [editingId, setEditingId] = useState(null)
    const [editName, setEditName] = useState('')
    const [editAmount, setEditAmount] = useState('')

    // Tab state
    const isManager = userRole === 'manager' || userRole === 'admin'
    const [activeTab, setActiveTab] = useState('daily') // 'daily' | 'fixed'

    const submitExpense = async () => {
        if (!costName.trim() || !costAmount || parseVNDInput(costAmount) <= 0) return
        setIsSubmitting(true)
        try {
            await onAddExpense(costName.trim(), parseVNDInput(costAmount))
            setCostName('')
            setCostAmount('')
        } catch (err) {
            console.error(err)
        } finally {
            setIsSubmitting(false)
        }
    }

    const submitFixedCost = async () => {
        if (!fixedName.trim() || !fixedAmount || parseVNDInput(fixedAmount) <= 0) return
        setIsFixedSubmitting(true)
        try {
            await onAddFixedCost(fixedName.trim(), parseVNDInput(fixedAmount))
            setFixedName('')
            setFixedAmount('')
        } catch (err) {
            console.error(err)
        } finally {
            setIsFixedSubmitting(false)
        }
    }

    const startEdit = (fc) => {
        setEditingId(fc.id)
        setEditName(fc.name)
        setEditAmount(formatVNDInput(fc.amount))
    }

    const submitEdit = async () => {
        if (!editName.trim() || !editAmount || parseVNDInput(editAmount) <= 0) return
        try {
            await onUpdateFixedCost(editingId, { name: editName.trim(), amount: parseVNDInput(editAmount) })
            setEditingId(null)
        } catch (err) {
            console.error(err)
        }
    }

    const totalExpense = (todayExpenses || []).reduce((sum, e) => sum + (e.amount || 0), 0)
    const totalFixed = (fixedCosts || []).reduce((sum, fc) => sum + (fc.amount || 0), 0)

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-bg sm:bg-black/50 sm:p-4 animate-fade-in backdrop-blur-sm">
            <div className="bg-bg w-full h-[100dvh] sm:h-[80dvh] sm:max-h-[600px] sm:max-w-md sm:rounded-[24px] shadow-lg animate-slide-up sm:animate-scale-up flex flex-col sm:border border-border/40 overflow-hidden">
                <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                        >
                            <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                        </button>

                        <div className="flex flex-row gap-2 flex-1">
                            <div
                                onClick={() => setActiveTab('daily')}
                                className={`flex-1 border shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'daily'
                                        ? 'bg-danger/10 border-danger/30'
                                        : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <span className="text-[12px] font-black text-danger uppercase line-clamp-1">Chi phí</span>
                            </div>

                            {isManager && (
                                <div
                                    onClick={() => setActiveTab('fixed')}
                                    className={`flex-1 border shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'fixed'
                                            ? 'bg-warning/10 border-warning/30'
                                            : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                        }`}
                                >
                                    <span className="text-[12px] font-black text-warning uppercase line-clamp-1">Cố định</span>
                                </div>
                            )}

                            <div
                                onClick={() => { onClose(); navigate('/recipes') }}
                                className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer"
                            >
                                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Công thức</span>
                            </div>
                        </div>
                    </div>
                </header>

                {/* ===== TAB: Daily Expenses ===== */}
                {activeTab === 'daily' && (
                    <>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {(!todayExpenses || todayExpenses.length === 0) ? (
                                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                                    Chưa có chi phí nào phát sinh hôm nay.
                                </div>
                            ) : (
                                [...todayExpenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(expense => {
                                    const time = `${new Date(expense.created_at).getHours().toString().padStart(2, '0')}:${new Date(expense.created_at).getMinutes().toString().padStart(2, '0')}`
                                    return (
                                        <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                                            <div className={`absolute top-0 right-0 text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider ${expense.is_fixed ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'
                                                }`}>
                                                {expense.is_fixed ? 'Cố định' : 'Chi phí'}
                                            </div>
                                            <div className="flex justify-between items-center mb-1">
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="font-black text-[14px] text-danger">- {formatVND(expense.amount)}</span>
                                                </div>
                                            </div>
                                            <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                                <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                                    <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                                                </div>
                                                <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                                    {!expense.is_fixed ? (
                                                        <span
                                                            className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                            onClick={() => {
                                                                if (deletingId === expense.id) return
                                                                if (window.confirm(`Xóa chi phí ${expense.name}?\n\nHành động này không thể hoàn tác!`)) {
                                                                    setDeletingId(expense.id)
                                                                    onDeleteExpense(expense.id, expense.amount).finally(() => setDeletingId(null))
                                                                }
                                                            }}
                                                        >
                                                            {deletingId === expense.id ? '⏳' : time}
                                                        </span>
                                                    ) : (
                                                        <span className="text-text-dim text-[14px] font-bold">{time}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>

                        <div className="p-4 bg-surface border-t border-border/60 flex flex-col gap-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Tên chi phí"
                                    value={costName}
                                    onChange={e => setCostName(e.target.value)}
                                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                                />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Số tiền..."
                                    value={costAmount}
                                    onChange={e => setCostAmount(formatVNDInput(e.target.value))}
                                    className="w-[120px] shrink-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitExpense()
                                    }}
                                />
                            </div>
                            <button
                                onClick={submitExpense}
                                disabled={!costName.trim() || !costAmount || parseVNDInput(costAmount) <= 0 || isSubmitting}
                                className="w-full py-3 rounded-[12px] bg-danger text-white text-[14px] font-black hover:bg-danger/90 active:bg-danger/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? 'Đang thêm...' : '+ Thêm chi phí'}
                            </button>
                        </div>
                    </>
                )}

                {/* ===== TAB: Fixed Costs ===== */}
                {activeTab === 'fixed' && isManager && (
                    <>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {/* Total fixed cost summary */}
                            <div className="bg-warning/5 border border-warning/20 rounded-[16px] px-4 py-3 flex items-center justify-between">
                                <span className="text-[12px] font-black text-warning uppercase">Tổng cố định / ngày</span>
                                <span className="text-[16px] font-bold text-warning tabular-nums">{formatVND(totalFixed)}</span>
                            </div>

                            {(!fixedCosts || fixedCosts.length === 0) ? (
                                <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                                    Chưa có chi phí cố định nào.
                                </div>
                            ) : (
                                fixedCosts.map(fc => (
                                    <div key={fc.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 right-0 bg-warning/10 text-warning text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                            Cố định
                                        </div>

                                        {editingId === fc.id ? (
                                            /* Edit mode */
                                            <div className="flex flex-col gap-2 mt-2">
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    className="bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[14px] font-medium text-text focus:outline-none focus:border-warning/40 transition-colors"
                                                    autoFocus
                                                />
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        value={editAmount}
                                                        onChange={e => setEditAmount(formatVNDInput(e.target.value))}
                                                        className="flex-1 bg-surface-light border border-border/60 rounded-[10px] px-3 py-2 text-[14px] font-medium text-text focus:outline-none focus:border-warning/40 transition-colors"
                                                    />
                                                    <button
                                                        onClick={submitEdit}
                                                        className="px-4 py-2 rounded-[10px] bg-warning text-white text-[13px] font-black hover:bg-warning/90 active:bg-warning/80 transition-colors"
                                                    >
                                                        Lưu
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingId(null)}
                                                        className="px-3 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text-secondary text-[13px] font-bold hover:bg-border/40 transition-colors"
                                                    >
                                                        Hủy
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* View mode */
                                            <>
                                                <div className="flex items-center gap-2 mt-1 mb-2">
                                                    <span className="font-black text-[14px] text-warning">- {formatVND(fc.amount)}</span>
                                                </div>
                                                <div className="flex justify-between items-center border-t border-border/40 pt-2">
                                                    <span className="text-[14px] leading-snug font-medium text-text">{fc.name}</span>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        <span
                                                            onClick={() => startEdit(fc)}
                                                            className="text-primary text-[13px] font-bold cursor-pointer hover:text-primary/80 transition-colors select-none"
                                                        >
                                                            Sửa
                                                        </span>
                                                        <span
                                                            onClick={() => {
                                                                if (deletingFixedId === fc.id) return
                                                                if (window.confirm(`Xóa chi phí cố định "${fc.name}"?\n\nChi phí này sẽ không còn được tính vào các ca sau.`)) {
                                                                    setDeletingFixedId(fc.id)
                                                                    onDeleteFixedCost(fc.id).finally(() => setDeletingFixedId(null))
                                                                }
                                                            }}
                                                            className="text-danger text-[13px] font-bold cursor-pointer hover:text-danger/80 transition-colors select-none"
                                                        >
                                                            {deletingFixedId === fc.id ? '⏳' : 'Xóa'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Add fixed cost form */}
                        <div className="p-4 bg-surface border-t border-border/60 flex flex-col gap-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Tên chi phí cố định"
                                    value={fixedName}
                                    onChange={e => setFixedName(e.target.value)}
                                    className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-warning/40 transition-colors"
                                />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Số tiền..."
                                    value={fixedAmount}
                                    onChange={e => setFixedAmount(formatVNDInput(e.target.value))}
                                    className="w-[120px] shrink-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-warning/40 transition-colors"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitFixedCost()
                                    }}
                                />
                            </div>
                            <button
                                onClick={submitFixedCost}
                                disabled={!fixedName.trim() || !fixedAmount || parseVNDInput(fixedAmount) <= 0 || isFixedSubmitting}
                                className="w-full py-3 rounded-[12px] bg-warning text-white text-[14px] font-black hover:bg-warning/90 active:bg-warning/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isFixedSubmitting ? 'Đang thêm...' : '+ Thêm chi phí cố định'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
