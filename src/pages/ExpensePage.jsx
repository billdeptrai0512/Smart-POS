import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatVND, formatVNDInput, parseVNDInput } from '../utils'
import { usePOS } from '../contexts/POSContext'
import { useAuth } from '../contexts/AuthContext'
import { ArrowLeft } from 'lucide-react'

export default function ExpensePage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { todayExpenses, isLoadingHistory, handleAddExpense, handleDeleteExpense, handleLoadHistory, fixedCosts, handleAddFixedCost, handleUpdateFixedCost, handleDeleteFixedCost, userRole } = usePOS()

    const { isStaff } = useAuth()

    const isManager = userRole === 'manager' || userRole === 'admin'
    const backTo = location.state?.from || '/history'
    const initialTab = location.state?.tab || 'daily'
    const [activeTab, setActiveTab] = useState((isStaff && initialTab === 'fixed') ? 'daily' : initialTab)

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

    useEffect(() => {
        if (!todayExpenses?.length && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const submitExpense = async () => {
        if (!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0) return
        setIsSubmitting(true)
        try {
            const isRefill = activeTab === 'refill'
            await handleAddExpense(costName.trim(), Number(costAmount) * 1000, isRefill, 'cash')
            setCostName('')
            setCostAmount('')
        } catch {
            // error handled in POSContext
        } finally {
            setIsSubmitting(false)
        }
    }

    const submitFixedCost = async () => {
        if (!fixedName.trim() || !fixedAmount || parseVNDInput(fixedAmount) <= 0) return
        setIsFixedSubmitting(true)
        try {
            await handleAddFixedCost(fixedName.trim(), parseVNDInput(fixedAmount))
            setFixedName('')
            setFixedAmount('')
        } catch {
            // error handled in POSContext
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
            await handleUpdateFixedCost(editingId, { name: editName.trim(), amount: parseVNDInput(editAmount) })
            setEditingId(null)
        } catch {
            // error handled in POSContext
        }
    }

    const expensesToView = location.state?.expensesToView
    const isReadOnly = location.state?.isReadOnly || false

    const baseExpenses = expensesToView || todayExpenses

    const dailyExpenses = (baseExpenses || []).filter(e => !e.is_fixed && !e.is_refill)
    const refillExpenses = (baseExpenses || []).filter(e => e.is_refill)
    const totalDaily = dailyExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
    const totalRefill = refillExpenses.reduce((sum, e) => sum + (e.amount || 0), 0)
    const totalFixed = (fixedCosts || []).reduce((sum, fc) => sum + (fc.amount || 0), 0)

    const activeExpenses = activeTab === 'daily' ? dailyExpenses : activeTab === 'refill' ? refillExpenses : []
    const isRefillTab = activeTab === 'refill'

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navigate(backTo)}
                        className="w-10 h-10 shrink-0 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                        title="Trở về"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div
                            onClick={() => { setActiveTab('daily'); setCostName(''); setCostAmount('') }}
                            className={`flex-1 border shadow-sm rounded-[14px] px-1 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'daily'
                                ? 'bg-danger/10 border-danger/30'
                                : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                }`}
                        >
                            <span className="text-[11px] font-black text-danger uppercase line-clamp-1">Chi phí</span>
                            <span className="text-[11px] font-bold text-danger/80 leading-none mt-1 tabular-nums">{formatVND(totalDaily)}</span>
                        </div>

                        <div
                            onClick={() => { setActiveTab('refill'); setCostName(''); setCostAmount('') }}
                            className={`flex-1 border shadow-sm rounded-[14px] px-1 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'refill'
                                ? 'bg-primary/10 border-primary/30'
                                : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                }`}
                        >
                            <span className="text-[11px] font-black text-primary uppercase line-clamp-1">NVL</span>
                            <span className="text-[11px] font-bold text-primary/80 leading-none mt-1 tabular-nums">{formatVND(totalRefill)}</span>
                        </div>

                        {!isStaff && (
                            <div
                                onClick={() => setActiveTab('fixed')}
                                className={`flex-1 border shadow-sm rounded-[14px] px-1 py-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${activeTab === 'fixed'
                                    ? 'bg-warning/10 border-warning/30'
                                    : 'bg-surface-light border-border/60 opacity-60 hover:opacity-100'
                                    }`}
                            >
                                <span className="text-[11px] font-black text-warning uppercase line-clamp-1">Cố định</span>
                                <span className="text-[11px] font-bold text-warning/80 leading-none mt-1 tabular-nums">{formatVND(totalFixed)}</span>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* ===== Daily & Refill tab ===== */}
            {(activeTab === 'daily' || activeTab === 'refill') && (
                <>
                    <main className="flex-1 overflow-y-auto p-4 space-y-3">
                        {isLoadingHistory ? (
                            <div className="flex flex-col gap-3 animate-pulse">
                                <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                                <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                            </div>
                        ) : (activeExpenses.length === 0) ? (
                            <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                                Chưa có {isRefillTab ? 'phiếu nhập nguyên vật liệu' : 'chi phí'} nào.
                            </div>
                        ) : (
                            [...activeExpenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(expense => {
                                const d = new Date(expense.created_at)
                                const time = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
                                const badgeClass = isRefillTab ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'
                                const badgeLabel = isRefillTab ? 'Mua NVL' : 'Chi phí'
                                return (
                                    <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                                        <div className={`absolute top-0 right-0 text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider ${badgeClass}`}>
                                            {badgeLabel}
                                        </div>
                                        <div className="flex justify-between items-center mb-1">
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`font-black text-[14px] ${isRefillTab ? 'text-primary' : 'text-danger'}`}>- {formatVND(expense.amount)}</span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                            <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                                <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                                            </div>
                                            <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                                {isReadOnly ? (
                                                    <span className="text-text-dim text-[14px] font-bold">{time}</span>
                                                ) : (
                                                    <span
                                                        className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                        onClick={() => {
                                                            if (deletingId === expense.id) return
                                                            if (window.confirm(`Xóa ${isRefillTab ? 'phiếu nhập' : 'chi phí'} ${expense.name}?\n\nHành động này không thể hoàn tác!`)) {
                                                                setDeletingId(expense.id)
                                                                handleDeleteExpense(expense.id, expense.amount).finally(() => setDeletingId(null))
                                                            }
                                                        }}
                                                    >
                                                        {deletingId === expense.id ? '⏳' : time}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </main>

                    {!isReadOnly && (
                        <div className="p-4 bg-surface border-t border-border/60 flex flex-col gap-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder={isRefillTab ? 'Tên nguyên vật liệu...' : 'Tên chi phí...'}
                                    value={costName}
                                    onChange={e => setCostName(e.target.value)}
                                    className={`flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none transition-colors ${isRefillTab ? 'focus:border-primary/40' : 'focus:border-danger/40'}`}
                                />
                                <div className={`relative shrink-0 flex items-center w-[125px] bg-surface-light border border-border/60 rounded-[12px] transition-colors overflow-hidden ${isRefillTab ? 'focus-within:border-primary/40' : 'focus-within:border-danger/40'}`}>
                                    <input
                                        type="number"
                                        placeholder="Số tiền..."
                                        value={costAmount}
                                        onChange={e => setCostAmount(e.target.value)}
                                        className="w-full bg-transparent px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') submitExpense()
                                        }}
                                    />
                                    {costAmount && (
                                        <div className="absolute inset-0 pointer-events-none px-3 py-2 flex items-center space-x-0 whitespace-pre z-0">
                                            <span className="text-[14px] font-medium text-transparent">{costAmount}</span>
                                            <span className="text-[14px] font-medium text-text">.000đ</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={submitExpense}
                                disabled={!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || isSubmitting}
                                className={`w-full py-3 rounded-[12px] text-white text-[14px] font-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isRefillTab ? 'bg-primary hover:bg-primary/90 active:bg-primary/80' : 'bg-danger hover:bg-danger/90 active:bg-danger/80'}`}
                            >
                                {isSubmitting ? 'Đang thêm...' : 'Thêm'}
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* ===== Fixed costs tab ===== */}
            {!isStaff && activeTab === 'fixed' && (
                <>
                    <main className="flex-1 overflow-y-auto p-4 space-y-3">

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
                                        <>
                                            <div className="flex items-center gap-2 mt-1 mb-2">
                                                <span className="font-black text-[14px] text-warning">- {formatVND(fc.amount)}</span>
                                            </div>
                                            <div className="flex justify-between items-center border-t border-border/40 pt-2">
                                                <span className="text-[14px] leading-snug font-medium text-text">{fc.name}</span>
                                                {isManager && !isReadOnly && (
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
                                                                    handleDeleteFixedCost(fc.id).finally(() => setDeletingFixedId(null))
                                                                }
                                                            }}
                                                            className="text-danger text-[13px] font-bold cursor-pointer hover:text-danger/80 transition-colors select-none"
                                                        >
                                                            {deletingFixedId === fc.id ? '⏳' : 'Xóa'}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))
                        )}
                    </main>

                    {isManager && !isReadOnly && (
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
                    )}
                </>
            )}
        </div>
    )
}
