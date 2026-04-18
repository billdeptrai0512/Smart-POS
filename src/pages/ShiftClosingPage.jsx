import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, PackageCheck } from 'lucide-react'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { formatVND, formatVNDInput, parseVNDInput } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { insertShiftClosing, updateShiftClosing, fetchTodayShiftClosing, fetchYesterdayShiftClosing, fetchIngredientCostsWithUnits, fetchFixedCosts, insertExpense, fetchTodayExpenses } from '../services/orderService'

import { ingredientLabel, getIngredientUnit, sortIngredients } from '../components/common/recipeUtils'

export default function ShiftClosingPage() {
    const navigate = useNavigate()
    const { todayOrders, isLoadingHistory, handleLoadHistory } = usePOS()
    const { selectedAddress } = useAddress()
    const { profile } = useAuth()

    // Load history if not loaded
    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // --- Revenue inputs ---
    const [actualCash, setActualCash] = useState('')
    const [actualTransfer, setActualTransfer] = useState('')
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [existingClosing, setExistingClosing] = useState(null)
    const [isLoadingExisting, setIsLoadingExisting] = useState(true)

    // --- Ingredient list with units ---
    const [ingredientsList, setIngredientsList] = useState([])
    const [isLoadingIngredients, setIsLoadingIngredients] = useState(true)
    const [inventoryInputs, setInventoryInputs] = useState({})
    const [restockInputs, setRestockInputs] = useState({})
    const [openingStock, setOpeningStock] = useState({})

    // Load existing shift closing data (for editing)
    useEffect(() => {
        if (selectedAddress?.id) {
            setIsLoadingExisting(true)
            fetchTodayShiftClosing(selectedAddress.id).then(data => {
                if (data) {
                    setExistingClosing(data)
                    setActualCash(data.actual_cash !== null && data.actual_cash !== undefined ? formatVNDInput(data.actual_cash) : '')
                    setActualTransfer(data.actual_transfer !== null && data.actual_transfer !== undefined ? formatVNDInput(data.actual_transfer) : '')
                    setNote(data.note || '')
                    // Pre-fill inventory inputs
                    if (data.inventory_report) {
                        let parsed = data.inventory_report
                        if (typeof parsed === 'string') {
                            try { parsed = JSON.parse(parsed) } catch (e) { }
                        }
                        if (Array.isArray(parsed)) {
                            const inputs = {}
                            const restocks = {}
                            parsed.forEach(item => {
                                inputs[item.ingredient] = String(item.remaining)
                                if (item.restock !== undefined && item.restock !== null) {
                                    restocks[item.ingredient] = String(item.restock)
                                }
                            })
                            setInventoryInputs(inputs)
                            setRestockInputs(restocks)
                        }
                    }
                }
            }).finally(() => {
                setIsLoadingExisting(false)
            })
        } else {
            setIsLoadingExisting(false)
        }
    }, [selectedAddress?.id])

    // Load yesterday's shift closing for opening stock
    useEffect(() => {
        if (selectedAddress?.id) {
            fetchYesterdayShiftClosing(selectedAddress.id).then(data => {
                if (data?.inventory_report && Array.isArray(data.inventory_report)) {
                    const stock = {}
                    data.inventory_report.forEach(item => {
                        stock[item.ingredient] = item.remaining || 0
                    })
                    setOpeningStock(stock)
                }
            })
        }
    }, [selectedAddress?.id])

    useEffect(() => {
        if (selectedAddress?.id) {
            setIsLoadingIngredients(true)
            fetchIngredientCostsWithUnits(selectedAddress.id).then(list => {
                const sortedList = [...list].sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order))
                setIngredientsList(sortedList)
            }).finally(() => {
                setIsLoadingIngredients(false)
            })
        } else {
            setIsLoadingIngredients(false)
        }
    }, [selectedAddress?.id, selectedAddress?.ingredient_sort_order])

    // --- Calculate system total revenue ---
    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

    let systemTotalRevenue = 0
    todayOrders.forEach(o => { systemTotalRevenue += o.total })
    offlineToday.forEach(o => { systemTotalRevenue += o.total })

    // --- Note: estimatedConsumption calculation is intentionally removed here as the shift closing process relies on manual actuals.

    const handleInventoryChange = (ingredient, value) => {
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
    }

    const handleRestockChange = (ingredient, value) => {
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
    }

    const handleSubmit = async () => {
        if (isSubmitting) return
        setIsSubmitting(true)

        try {
            const inventoryReport = ingredientsList
                .filter(ing => {
                    const hasRemaining = inventoryInputs[ing.ingredient] !== undefined && inventoryInputs[ing.ingredient] !== ''
                    const hasRestock = restockInputs[ing.ingredient] !== undefined && restockInputs[ing.ingredient] !== ''
                    return hasRemaining || hasRestock
                })
                .map(ing => {
                    const unit = getIngredientUnit(ing.ingredient, ing.unit)
                    return {
                        ingredient: ing.ingredient,
                        unit: unit,
                        remaining: Number(inventoryInputs[ing.ingredient]) || 0,
                        restock: Number(restockInputs[ing.ingredient]) || 0
                    }
                })

            const payload = {
                address_id: selectedAddress?.id,
                closed_by: profile?.id || null,
                system_total_revenue: systemTotalRevenue,
                actual_cash: parseVNDInput(actualCash),
                actual_transfer: parseVNDInput(actualTransfer),
                inventory_report: inventoryReport,
                note: note.trim()
            }

            if (existingClosing?.id) {
                await updateShiftClosing(existingClosing.id, payload)
            } else {
                await insertShiftClosing(payload)

                // Auto-inject fixed costs as expenses (only for first-time shift close)
                try {
                    const fixedCosts = await fetchFixedCosts(selectedAddress?.id)
                    if (fixedCosts.length > 0) {
                        // Check if fixed expenses were already injected today
                        const todayExpenses = await fetchTodayExpenses(selectedAddress?.id)
                        const alreadyInjected = todayExpenses.some(e => e.is_fixed === true)
                        if (!alreadyInjected) {
                            await Promise.all(
                                fixedCosts.map(fc =>
                                    insertExpense(`[CĐ] ${fc.name}`, fc.amount, selectedAddress?.id, true)
                                )
                            )
                        }
                    }
                } catch (fixedErr) {
                    console.error('Fixed cost injection error:', fixedErr)
                    // Non-blocking: shift closing still succeeds
                }
            }

            navigate('/daily-report')
        } catch (err) {
            console.error('Shift closing error:', err)
            alert('Lỗi khi chốt ca. Vui lòng thử lại.')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/history')}
                        className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                        title="Trở về"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex flex-row gap-2 flex-1">
                        <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                            <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Chốt Ca</span>
                            <span className="text-[12px] font-bold text-primary/80 leading-none mt-1 tabular-nums">{formatVND(systemTotalRevenue)}</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 overflow-y-auto px-4 py-5 pb-28 space-y-5 bg-bg">
                {isLoadingHistory ? (
                    <div className="flex flex-col gap-3 animate-pulse">
                        <div className="bg-surface-light rounded-[20px] h-24 w-full" />
                        <div className="bg-surface-light rounded-[20px] h-40 w-full" />
                    </div>
                ) : (
                    <>
                        {/* Section 1: Revenue Input */}
                        <div>
                            <div className="flex items-center gap-3 py-1 mb-3 px-1">
                                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Doanh thu thực tế</span>
                                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                            </div>

                            <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm space-y-3">
                                {/* Cash input */}
                                <div className="flex items-center gap-3">
                                    <span className="text-[13px] font-bold text-text w-[110px] shrink-0">Tiền mặt</span>
                                    <div className="relative flex-1 flex items-center bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="Số tiền..."
                                            value={actualCash}
                                            onChange={e => setActualCash(formatVNDInput(e.target.value))}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none"
                                        />
                                        {actualCash && (
                                            <span className="text-[14px] font-medium text-text-secondary pr-3 shrink-0 pointer-events-none">đ</span>
                                        )}
                                    </div>
                                </div>

                                {/* Transfer input */}
                                <div className="flex items-center gap-3">
                                    <span className="text-[13px] font-bold text-text w-[110px] shrink-0">Chuyển khoản</span>
                                    <div className="relative flex-1 flex items-center bg-surface-light border border-border/60 rounded-[12px] focus-within:border-primary/40 transition-colors overflow-hidden">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            placeholder="Số tiền..."
                                            value={actualTransfer}
                                            onChange={e => setActualTransfer(formatVNDInput(e.target.value))}
                                            className="w-full bg-transparent px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none"
                                        />
                                        {actualTransfer && (
                                            <span className="text-[14px] font-medium text-text-secondary pr-3 shrink-0 pointer-events-none">đ</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Section 2: Inventory Report */}
                        {isLoadingIngredients ? (
                            <div className="flex flex-col gap-3 py-4 animate-pulse">
                                <div className="bg-surface-light rounded-[12px] h-8 w-1/3 mb-2" />
                                <div className="bg-surface-light rounded-[20px] h-32 w-full" />
                            </div>
                        ) : ingredientsList.length > 0 && (
                            <div>
                                <div className="flex items-center gap-3 py-1 mb-3 px-1">
                                    <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                    <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Kiểm kê tồn kho</span>
                                    <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                </div>

                                <div className="bg-surface rounded-[20px] p-3 border border-border/60 shadow-sm space-y-2">
                                    {ingredientsList.map(ing => {
                                        const unit = getIngredientUnit(ing.ingredient, ing.unit)
                                        const opening = openingStock[ing.ingredient]
                                        return (
                                            <div key={ing.ingredient} className="border-b border-border/20 last:border-0 pb-2 last:pb-0">
                                                {/* Row 1: ingredient name + unit */}
                                                <span className="text-[12px] font-bold text-text block mb-1.5">{ingredientLabel(ing.ingredient)} <span className="text-text-dim font-normal">({unit})</span></span>
                                                {/* Row 2: 3 columns */}
                                                <div className="grid grid-cols-3 gap-2">
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Tồn đầu</span>
                                                        <span className="w-full bg-surface-light border border-border/60 rounded-[10px] px-2 py-1 text-[13px] font-medium text-text-secondary text-center tabular-nums block">
                                                            {opening !== undefined && opening !== null ? opening : '—'}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Nhập thêm</span>
                                                        <input
                                                            type="number"
                                                            placeholder="0"
                                                            value={restockInputs[ing.ingredient] || ''}
                                                            onChange={e => handleRestockChange(ing.ingredient, e.target.value)}
                                                            className="w-full bg-surface-light border border-border/60 rounded-[10px] px-2 py-1 text-[13px] font-medium text-text text-center placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col items-center">
                                                        <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Tồn cuối</span>
                                                        <input
                                                            type="number"
                                                            placeholder="0"
                                                            value={inventoryInputs[ing.ingredient] || ''}
                                                            onChange={e => handleInventoryChange(ing.ingredient, e.target.value)}
                                                            className="w-full bg-surface-light border border-border/60 rounded-[10px] px-2 py-1 text-[13px] font-medium text-text text-center placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Section 3: Note */}
                        <div>
                            <div className="flex items-center gap-3 py-1 mb-3 px-1">
                                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                                <span className="text-[11px] font-black text-text-secondary uppercase tracking-widest whitespace-nowrap opacity-80">Ghi chú</span>
                                <div className="flex-1 h-[1px] bg-border/80 rounded-full" />
                            </div>

                            <textarea
                                placeholder="Ghi chú thêm (tùy chọn)..."
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                rows={3}
                                className="w-full bg-surface border border-border/60 rounded-[20px] px-4 py-3 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors resize-none shadow-sm"
                            />
                        </div>
                    </>
                )}
            </main>

            {/* Fixed footer */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-bg via-bg via-60% to-transparent pointer-events-none">
                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || isLoadingHistory || isLoadingIngredients || isLoadingExisting}
                    className="w-full py-3.5 rounded-[16px] bg-primary text-white text-[14px] font-black uppercase tracking-wide hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm pointer-events-auto flex items-center justify-center gap-2"
                >
                    <PackageCheck size={18} strokeWidth={2.5} />
                    {isSubmitting ? 'Đang xử lý...' : existingClosing ? 'Cập nhật chốt ca' : 'Xác nhận chốt ca'}
                </button>
            </div>
        </div>
    )
}
