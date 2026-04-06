import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatVND } from '../utils'
import { usePOS } from '../contexts/POSContext'
import { CircleArrowRight } from 'lucide-react'

export default function ExpensePage() {
    const navigate = useNavigate()
    const { todayExpenses, isLoadingHistory, handleAddExpense, handleDeleteExpense, handleLoadHistory } = usePOS()

    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deletingId, setDeletingId] = useState(null)

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
            await handleAddExpense(costName.trim(), Number(costAmount))
            setCostName('')
            setCostAmount('')
        } catch (err) {
            console.error(err)
        } finally {
            setIsSubmitting(false)
        }
    }

    const totalExpense = (todayExpenses || []).reduce((sum, e) => sum + (e.amount || 0), 0)

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/history')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div className="flex-1 bg-danger/5 border border-danger/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-danger uppercase line-clamp-1">Chi phí</span>
                            <span className="text-[12px] font-bold text-danger/80 leading-none mt-1 tabular-nums">{formatVND(totalExpense)}</span>
                        </div>

                        <button onClick={() => navigate('/recipes')}
                            className="flex-1 bg-primary/5 border border-primary/10 rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-primary/15 active:bg-primary/20 active:scale-[0.98] transition-all select-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                            title="Công thức"
                        >
                            <div className="flex items-center gap-1">
                                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Công thức</span>
                                <CircleArrowRight size={14} className="text-primary" strokeWidth={2.5} />
                            </div>
                        </button>
                    </div>
                </div>
            </header >

            <main className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoadingHistory ? (
                    <div className="flex flex-col gap-3 animate-pulse">
                        <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                        <div className="bg-surface-light rounded-[20px] h-20 w-full" />
                    </div>
                ) : (!todayExpenses || todayExpenses.length === 0) ? (
                    <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                        Chưa có chi phí nào phát sinh hôm nay.
                    </div>
                ) : (
                    [...todayExpenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(expense => {
                        const time = `${new Date(expense.created_at).getHours().toString().padStart(2, '0')}:${new Date(expense.created_at).getMinutes().toString().padStart(2, '0')}`
                        return (
                            <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                                <div className="absolute top-0 right-0 bg-danger/10 text-danger text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                    Chi phí
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
                                        <span
                                            className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                            onClick={() => {
                                                if (deletingId === expense.id) return
                                                if (window.confirm(`Xóa chi phí ${expense.name}?\n\nHành động này không thể hoàn tác!`)) {
                                                    setDeletingId(expense.id)
                                                    handleDeleteExpense(expense.id, expense.amount).finally(() => setDeletingId(null))
                                                }
                                            }}
                                        >
                                            {deletingId === expense.id ? '⏳' : time}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </main>

            <div className="p-4 bg-surface border-t border-border/60 flex flex-col gap-3">
                {/* <div className="flex justify-between">
                    <span className='text-[16px] font-bold text-text-secondary'>Tổng cộng</span>
                    <span className="text-[16px] font-bold text-danger/80 leading-none mt-1 tabular-nums">{formatVND(totalExpense)}</span>
                </div> */}

                {/* input modal */}
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Chi phí gì ?"
                        value={costName}
                        onChange={e => setCostName(e.target.value)}
                        className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                    />
                    <input
                        type="number"
                        placeholder="Bao nhiêu ?"
                        value={costAmount}
                        onChange={e => setCostAmount(e.target.value)}
                        className="w-[110px] shrink-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitExpense()
                        }}
                    />
                </div>

                <button
                    onClick={submitExpense}
                    disabled={!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || isSubmitting}
                    className="w-full py-3 rounded-[12px] bg-danger text-white text-[14px] font-black hover:bg-danger/90 active:bg-danger/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSubmitting ? 'Đang thêm...' : 'Tạo'}

                </button>
            </div>
        </div >
    )
}
