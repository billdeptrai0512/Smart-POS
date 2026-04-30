import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, PackageCheck } from 'lucide-react'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { Lock, Unlock } from 'lucide-react'
import { formatVND, formatVNDInput, parseVNDInput } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { insertShiftClosing, updateShiftClosing, fetchTodayShiftClosing, fetchYesterdayShiftClosing, fetchIngredientCostsWithUnits, fetchFixedCosts, insertExpense, fetchTodayExpenses } from '../services/orderService'
import { supabase } from '../lib/supabaseClient'
import { ingredientLabel, sortIngredients } from '../components/common/recipeUtils'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'

export default function ShiftClosingPage() {
    const navigate = useNavigate()
    const channelRef = React.useRef(null)
    const { todayOrders, isLoadingHistory, handleLoadHistory } = usePOS()
    const { selectedAddress } = useAddress()
    const { toast, showError } = useToast()
    const { profile, isManager, isAdmin } = useAuth()
    const canUnlock = isManager || isAdmin

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
    const [openingInputs, setOpeningInputs] = useState({})
    const [openingLocked, setOpeningLocked] = useState({})

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
                            try { parsed = JSON.parse(parsed) } catch {
                                console.warn('Could not parse inventory_report JSON, ignoring')
                            }
                        }
                        if (Array.isArray(parsed)) {
                            const inputs = {}
                            const restocks = {}
                            const openings = {}
                            const locked = {}
                            parsed.forEach(item => {
                                inputs[item.ingredient] = String(item.remaining)
                                if (item.restock !== undefined && item.restock !== null) {
                                    restocks[item.ingredient] = String(item.restock)
                                }
                                if (item.opening !== undefined && item.opening !== null) {
                                    openings[item.ingredient] = String(item.opening)
                                }
                                if (item.opening_locked) {
                                    locked[item.ingredient] = true
                                }
                            })
                            setInventoryInputs(inputs)
                            setRestockInputs(restocks)
                            if (Object.keys(openings).length) setOpeningInputs(openings)
                            if (Object.keys(locked).length) setOpeningLocked(locked)
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
                    const openings = {}
                    data.inventory_report.forEach(item => {
                        stock[item.ingredient] = item.remaining || 0
                        openings[item.ingredient] = String(item.remaining || 0)
                    })
                    setOpeningStock(stock)
                    // Seed openingInputs from yesterday only if today's closing hasn't set them yet
                    setOpeningInputs(prev => {
                        if (Object.keys(prev).length > 0) return prev
                        return openings
                    })
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

    // --- Supabase Realtime Broadcast ---
    useEffect(() => {
        if (!selectedAddress?.id) return;

        const channelName = `shift-closing-${selectedAddress.id}`
        const channel = supabase.channel(channelName, {
            config: {
                broadcast: { self: false } // don't receive our own messages
            }
        })

        channel
            .on('broadcast', { event: 'sync-state' }, ({ payload }) => {
                if (payload.type === 'actualCash') setActualCash(payload.value);
                if (payload.type === 'actualTransfer') setActualTransfer(payload.value);
                if (payload.type === 'note') setNote(payload.value);
                if (payload.type === 'inventory') {
                    setInventoryInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }));
                }
                if (payload.type === 'restock') {
                    setRestockInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }));
                }
                if (payload.type === 'opening') {
                    setOpeningInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }));
                }
                if (payload.type === 'openingLocked') {
                    setOpeningLocked(prev => ({ ...prev, [payload.ingredient]: payload.value }));
                }
            })
            .subscribe()

        channelRef.current = channel

        return () => {
            supabase.removeChannel(channel)
        }
    }, [selectedAddress?.id])

    // --- Calculate system total revenue ---
    const pending = getPendingOrders()
    const todayStr = new Date().toDateString()
    const offlineToday = pending.filter(o => new Date(o.createdAt).toDateString() === todayStr)

    let systemTotalRevenue = 0
    todayOrders.forEach(o => { systemTotalRevenue += o.total })
    offlineToday.forEach(o => { systemTotalRevenue += o.total })

    // --- Note: estimatedConsumption calculation is intentionally removed here as the shift closing process relies on manual actuals.

    const handleOpeningChange = (ingredient, value) => {
        setOpeningInputs(prev => ({ ...prev, [ingredient]: value }))
        channelRef.current?.send({
            type: 'broadcast', event: 'sync-state',
            payload: { type: 'opening', ingredient, value }
        }).catch(() => { })
    }

    const handleOpeningLock = (ingredient, locked) => {
        setOpeningLocked(prev => ({ ...prev, [ingredient]: locked }))
        channelRef.current?.send({
            type: 'broadcast', event: 'sync-state',
            payload: { type: 'openingLocked', ingredient, value: locked }
        }).catch(() => { })
    }

    const handleInventoryChange = (ingredient, value) => {
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
        channelRef.current?.send({
            type: 'broadcast',
            event: 'sync-state',
            payload: { type: 'inventory', ingredient, value }
        }).catch(() => { })
    }

    const handleRestockChange = (ingredient, value) => {
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
        channelRef.current?.send({
            type: 'broadcast',
            event: 'sync-state',
            payload: { type: 'restock', ingredient, value }
        }).catch(() => { })
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
                    return {
                        ingredient: ing.ingredient,
                        unit: ing.unit || 'đv',
                        opening: openingInputs[ing.ingredient] !== undefined ? Number(openingInputs[ing.ingredient]) : null,
                        opening_locked: openingLocked[ing.ingredient] || false,
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
                    showError(fixedErr, 'Ghi chi phí cố định vào ca')
                }
            }

            navigate('/daily-report')
        } catch (err) {
            showError(err, 'Chốt ca')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />
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
                                            onChange={e => {
                                                const val = formatVNDInput(e.target.value);
                                                setActualCash(val);
                                                channelRef.current?.send({ type: 'broadcast', event: 'sync-state', payload: { type: 'actualCash', value: val } }).catch(() => { });
                                            }}
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
                                            onChange={e => {
                                                const val = formatVNDInput(e.target.value);
                                                setActualTransfer(val);
                                                channelRef.current?.send({ type: 'broadcast', event: 'sync-state', payload: { type: 'actualTransfer', value: val } }).catch(() => { });
                                            }}
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

                                <div className="bg-surface rounded-[20px] p-3 border border-border/60 shadow-sm space-y-3">
                                    {ingredientsList.map(ing => {
                                        const unit = ing.unit || 'đv'
                                        const opening = openingStock[ing.ingredient]
                                        const isLocked = openingLocked[ing.ingredient]
                                        const showLockBtn = !isLocked || canUnlock
                                        return (
                                            <div key={ing.ingredient} className="border-b border-border/20 last:border-0 pb-2.5 last:pb-0">
                                                {/* Row 1: name */}
                                                <span className="text-[12px] font-bold text-text block mb-1.5">{ingredientLabel(ing.ingredient)}</span>

                                                {/* Row 2: 3 columns */}
                                                <div className="grid grid-cols-3 gap-2">
                                                    {/* Tồn đầu */}
                                                    <div className="flex flex-col">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-[9px] font-black text-text-dim uppercase">Tồn đầu</span>
                                                            {showLockBtn && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpeningLock(ing.ingredient, !isLocked)}
                                                                    className={`transition-colors ${isLocked ? 'text-primary' : 'text-text-dim hover:text-primary'}`}
                                                                >
                                                                    {isLocked ? <Lock size={10} strokeWidth={2.5} /> : <Unlock size={10} strokeWidth={2} />}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className={`flex items-center rounded-[10px] overflow-hidden transition-all gap-1 ${isLocked ? 'bg-primary/8 border border-primary/30' : 'bg-surface-light border border-border/60 focus-within:border-primary/40'}`}>
                                                            <input
                                                                type="number"
                                                                placeholder="0"
                                                                value={openingInputs[ing.ingredient] ?? (opening !== undefined && opening !== null ? String(opening) : '')}
                                                                onChange={e => handleOpeningChange(ing.ingredient, e.target.value)}
                                                                disabled={isLocked}
                                                                className={`flex-1 min-w-0 bg-transparent pl-2 py-1.5 text-[13px] font-bold text-right placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${isLocked ? 'text-primary cursor-not-allowed' : 'text-text'}`}
                                                            />
                                                            <span className={`pr-1.5 text-[10px] font-medium shrink-0 ${isLocked ? 'text-primary/70' : 'text-text-dim'}`}>{unit}</span>
                                                        </div>
                                                    </div>

                                                    {/* Nhập thêm */}
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] font-black text-text-dim uppercase mb-1">Nhập thêm</span>
                                                        <div className="flex items-center gap-1 bg-surface-light border border-border/60 rounded-[10px] overflow-hidden focus-within:border-primary/40 transition-colors">
                                                            <input
                                                                type="number"
                                                                placeholder="0"
                                                                value={restockInputs[ing.ingredient] || ''}
                                                                onChange={e => handleRestockChange(ing.ingredient, e.target.value)}
                                                                className="flex-1 min-w-0 bg-transparent pl-2 py-1.5 text-[13px] font-medium text-text text-right placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            />
                                                            <span className="pr-1.5 text-[10px] font-medium text-text-dim shrink-0">{unit}</span>
                                                        </div>
                                                    </div>

                                                    {/* Tồn cuối */}
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] font-black text-text-dim uppercase mb-1">Tồn cuối</span>
                                                        <div className="flex items-center gap-1 bg-surface-light border border-border/60 rounded-[10px] overflow-hidden focus-within:border-primary/40 transition-colors">
                                                            <input
                                                                type="number"
                                                                placeholder="0"
                                                                value={inventoryInputs[ing.ingredient] || ''}
                                                                onChange={e => handleInventoryChange(ing.ingredient, e.target.value)}
                                                                className="flex-1 min-w-0 bg-transparent pl-2 py-1.5 text-[13px] font-medium text-text text-right placeholder:text-text-secondary/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            />
                                                            <span className="pr-1.5 text-[10px] font-medium text-text-dim shrink-0">{unit}</span>
                                                        </div>
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
                                onChange={e => {
                                    const val = e.target.value;
                                    setNote(val);
                                    channelRef.current?.send({ type: 'broadcast', event: 'sync-state', payload: { type: 'note', value: val } }).catch(() => { });
                                }}
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
