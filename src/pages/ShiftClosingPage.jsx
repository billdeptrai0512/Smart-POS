import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { formatVNDInput, parseVNDInput } from '../utils'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { insertShiftClosing, updateShiftClosing, fetchTodayShiftClosing, fetchYesterdayShiftClosing, fetchIngredientCostsWithUnits, fetchFixedCosts, insertExpense, fetchTodayExpenses, invalidateDailyContext, fetchIngredientStocks } from '../services/orderService'
import { dateStringVN } from '../utils/dateVN'
import { supabase } from '../lib/supabaseClient'
import { sortIngredients } from '../components/common/recipeUtils'
import { useToast } from '../hooks/useToast'
import { useEntitlement, hasFeature } from '../hooks/useEntitlement'
import Toast from '../components/POSPage/Toast'
import UpsellPage from '../components/common/UpsellPage'
import ShiftClosingHeader from '../components/ShiftClosingPage/ShiftClosingHeader'
import RevenueInputCard from '../components/ShiftClosingPage/RevenueInputCard'
import InventoryReportCard from '../components/ShiftClosingPage/InventoryReportCard'
import NoteCard from '../components/ShiftClosingPage/NoteCard'

export default function ShiftClosingPage() {
    const navigate = useNavigate()
    const channelRef = React.useRef(null)
    const { todayOrders, isLoadingHistory, handleLoadHistory } = usePOS()
    const { selectedAddress } = useAddress()
    const { toast, showError } = useToast()
    const { profile, isManager, isAdmin } = useAuth()
    const { activeModules } = useEntitlement()
    const canUnlock = isManager || isAdmin

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) handleLoadHistory()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [activeTab, setActiveTab] = useState('inventory') // 'inventory' | 'revenue' | 'note'

    // --- Revenue inputs ---
    const [actualCash, setActualCash] = useState('')
    const [actualTransfer, setActualTransfer] = useState('')
    const [note, setNote] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [showPaywall, setShowPaywall] = useState(false)
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
    // Canonical warehouse balance per ingredient (from fetchIngredientStocks). Used to
    // surface "kho tổng còn X" and validate that staff's `restock` input doesn't exceed
    // what's available — prevents over-report which silently creates deficits.
    const [warehouseStocks, setWarehouseStocks] = useState({})

    // Load existing shift closing (for editing)
    useEffect(() => {
        if (!selectedAddress?.id) { setIsLoadingExisting(false); return }
        setIsLoadingExisting(true)
        fetchTodayShiftClosing(selectedAddress.id).then(data => {
            if (!data) return
            setExistingClosing(data)
            setActualCash(data.actual_cash != null ? formatVNDInput(data.actual_cash) : '')
            setActualTransfer(data.actual_transfer != null ? formatVNDInput(data.actual_transfer) : '')
            setNote(data.note || '')

            let parsed = data.inventory_report
            if (typeof parsed === 'string') {
                try { parsed = JSON.parse(parsed) } catch { console.warn('Could not parse inventory_report JSON, ignoring') }
            }
            if (!Array.isArray(parsed)) return

            const inputs = {}, restocks = {}, openings = {}, locked = {}
            parsed.forEach(item => {
                if (typeof item.remaining === 'number') inputs[item.ingredient] = String(item.remaining)
                if (typeof item.restock === 'number') restocks[item.ingredient] = String(item.restock)
                if (typeof item.opening === 'number') openings[item.ingredient] = String(item.opening)
                if (item.opening_locked) locked[item.ingredient] = true
            })
            setInventoryInputs(inputs)
            setRestockInputs(restocks)
            if (Object.keys(openings).length) setOpeningInputs(openings)
            if (Object.keys(locked).length) setOpeningLocked(locked)
        }).finally(() => setIsLoadingExisting(false))
    }, [selectedAddress?.id])

    // Canonical reader: pull warehouse + counter stocks via fetchIngredientStocks (one source).
    // counter_stock seeds the "Tồn đầu" column (= previous shift's remaining).
    // warehouse_stock is shown alongside each row as "kho tổng còn X" and used to
    // validate the restock input (Tầng 2 prevention).
    // Re-runs on tab visibility regain so a manager doing /ingredients → + Nhập kho
    // mid-shift gets reflected here without a manual refresh (Task 3.7).
    useEffect(() => {
        if (!selectedAddress?.id) return
        const load = () => fetchIngredientStocks(selectedAddress.id).then(rows => {
            const counters = {}, openings = {}, warehouses = {}
            ;(rows || []).forEach(r => {
                if (typeof r.counter_stock === 'number') {
                    counters[r.ingredient] = r.counter_stock
                    openings[r.ingredient] = String(r.counter_stock)
                }
                if (typeof r.warehouse_stock === 'number') {
                    warehouses[r.ingredient] = r.warehouse_stock
                }
            })
            setOpeningStock(counters)
            setWarehouseStocks(warehouses)
            // Seed only if today's closing hasn't set them yet
            setOpeningInputs(prev => Object.keys(prev).length > 0 ? prev : openings)
        })
        load()
        const onVis = () => { if (document.visibilityState === 'visible') load() }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [selectedAddress?.id])

    useEffect(() => {
        if (!selectedAddress?.id) { setIsLoadingIngredients(false); return }
        setIsLoadingIngredients(true)
        fetchIngredientCostsWithUnits(selectedAddress.id).then(list => {
            const sorted = [...list].sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order))
            setIngredientsList(sorted)
        }).finally(() => setIsLoadingIngredients(false))
    }, [selectedAddress?.id, selectedAddress?.ingredient_sort_order])

    // --- Supabase Realtime Broadcast ---
    useEffect(() => {
        if (!selectedAddress?.id) return

        const channel = supabase.channel(`shift-closing-${selectedAddress.id}`, {
            config: { broadcast: { self: false } }
        })

        channel
            .on('broadcast', { event: 'sync-state' }, ({ payload }) => {
                if (payload.type === 'actualCash') setActualCash(payload.value)
                if (payload.type === 'actualTransfer') setActualTransfer(payload.value)
                if (payload.type === 'note') setNote(payload.value)
                if (payload.type === 'inventory') setInventoryInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }))
                if (payload.type === 'restock') setRestockInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }))
                if (payload.type === 'opening') setOpeningInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }))
                if (payload.type === 'openingLocked') setOpeningLocked(prev => ({ ...prev, [payload.ingredient]: payload.value }))
            })
            .subscribe()

        channelRef.current = channel
        return () => { supabase.removeChannel(channel) }
    }, [selectedAddress?.id])

    const broadcast = (payload) => {
        channelRef.current?.send({ type: 'broadcast', event: 'sync-state', payload }).catch(() => { })
    }

    // --- System total revenue ---
    const pending = getPendingOrders()
    const todayStr = dateStringVN()
    const offlineToday = pending.filter(o => dateStringVN(new Date(o.createdAt)) === todayStr)
    let systemTotalRevenue = 0
    todayOrders.forEach(o => { if (!o.deleted_at && !o.deletedAt) systemTotalRevenue += o.total })
    offlineToday.forEach(o => { if (!o.deleted_at && !o.deletedAt) systemTotalRevenue += o.total })

    // --- Change handlers ---
    const handleCashChange = (raw) => {
        const val = formatVNDInput(raw)
        setIsDirty(true); setActualCash(val)
        broadcast({ type: 'actualCash', value: val })
    }
    const handleTransferChange = (raw) => {
        const val = formatVNDInput(raw)
        setIsDirty(true); setActualTransfer(val)
        broadcast({ type: 'actualTransfer', value: val })
    }
    const handleNoteChange = (val) => {
        setIsDirty(true); setNote(val)
        broadcast({ type: 'note', value: val })
    }
    const handleOpeningChange = (ingredient, value) => {
        setIsDirty(true)
        setOpeningInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'opening', ingredient, value })
    }
    const handleOpeningLock = (ingredient, locked) => {
        setIsDirty(true)
        setOpeningLocked(prev => ({ ...prev, [ingredient]: locked }))
        broadcast({ type: 'openingLocked', ingredient, value: locked })
    }
    const handleInventoryChange = (ingredient, value) => {
        setIsDirty(true)
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'inventory', ingredient, value })
    }
    const handleRestockChange = (ingredient, value) => {
        setIsDirty(true)
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'restock', ingredient, value })
    }

    const handleBack = () => {
        if (isDirty && !window.confirm('Bạn có thay đổi chưa lưu. Trở về sẽ làm mất các dữ liệu này. Tiếp tục?')) return
        window.history.length > 2 ? navigate(-1) : navigate('/history')
    }

    const handleSubmit = async () => {
        if (isSubmitting) return
        setIsSubmitting(true)
        try {
            const inventoryReport = ingredientsList
                .filter(ing => {
                    const hasRemaining = inventoryInputs[ing.ingredient] !== undefined && inventoryInputs[ing.ingredient] !== ''
                    const hasRestock = restockInputs[ing.ingredient] !== undefined && restockInputs[ing.ingredient] !== ''
                    const hasOpening = openingInputs[ing.ingredient] !== undefined && openingInputs[ing.ingredient] !== ''
                    return hasRemaining || hasRestock || hasOpening
                })
                .map(ing => ({
                    ingredient: ing.ingredient,
                    unit: ing.unit || 'đv',
                    opening: openingInputs[ing.ingredient] !== undefined ? Number(openingInputs[ing.ingredient]) : null,
                    opening_locked: openingLocked[ing.ingredient] || false,
                    remaining: Number(inventoryInputs[ing.ingredient]) || 0,
                    restock: Number(restockInputs[ing.ingredient]) || 0
                }))

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
                // Auto-inject fixed costs as expenses (only for first-time shift close).
                // Parallel fetch — fixedCosts + todayExpenses are independent, both needed.
                try {
                    const [fixedCosts, todayExpenses] = await Promise.all([
                        fetchFixedCosts(selectedAddress?.id),
                        fetchTodayExpenses(selectedAddress?.id),
                    ])
                    if (fixedCosts.length > 0) {
                        const alreadyInjected = todayExpenses.some(e => e.is_fixed === true)
                        if (!alreadyInjected) {
                            await Promise.all(
                                fixedCosts.map(fc => insertExpense(`[CĐ] ${fc.name}`, fc.amount, selectedAddress?.id, true))
                            )
                        }
                    }
                } catch (fixedErr) {
                    showError(fixedErr, 'Ghi chi phí cố định vào ca')
                }
            }
            invalidateDailyContext(selectedAddress?.id)

            setIsDirty(false)
            if (hasFeature(activeModules, 'reports')) {
                navigate('/daily-report', { replace: true })
            } else {
                setShowPaywall(true)
            }
        } catch (err) {
            showError(err, 'Chốt ca')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            {showPaywall ? (
                <div className="absolute inset-0 z-50 bg-bg">
                    <UpsellPage backTo="/history" successMessage="Dữ liệu chốt ca đã được lưu thành công!" />
                </div>
            ) : (
                <>
                    <ShiftClosingHeader
                        systemTotalRevenue={systemTotalRevenue}
                        isSubmitting={isSubmitting}
                        isDisabled={isSubmitting || isLoadingHistory || isLoadingIngredients || isLoadingExisting}
                        onBack={handleBack}
                        onSubmit={handleSubmit}
                        activeTab={activeTab}
                        onTabSelect={setActiveTab}
                    />

                    <main className="flex-1 overflow-y-auto px-4 py-5 space-y-5 bg-bg">
                        {isLoadingHistory ? (
                            <div className="flex flex-col gap-3 animate-pulse">
                                <div className="bg-surface-light rounded-[20px] h-24 w-full" />
                                <div className="bg-surface-light rounded-[20px] h-40 w-full" />
                            </div>
                        ) : (
                            <>
                                {activeTab === 'inventory' && (
                                    <>
                                        <p className="text-[11px] text-text-secondary leading-snug bg-primary/5 border border-primary/15 rounded-[10px] px-3 py-2 -mb-2">
                                            Cột <span className="font-bold text-text">"Nhập thêm"</span> = số rút từ kho tổng → quầy.
                                            Mua nguyên liệu mới phải qua <span className="font-bold text-text">/ingredients → + Nhập kho</span> trước, không để hàng thẳng lên quầy.
                                        </p>
                                        <InventoryReportCard
                                            ingredientsList={ingredientsList}
                                            isLoading={isLoadingIngredients}
                                            openingStock={openingStock}
                                            openingInputs={openingInputs}
                                            openingLocked={openingLocked}
                                            restockInputs={restockInputs}
                                            inventoryInputs={inventoryInputs}
                                            warehouseStocks={warehouseStocks}
                                            ingredientUnits={Object.fromEntries(ingredientsList.map(i => [i.ingredient, i.unit]))}
                                            canUnlock={canUnlock}
                                            isSubmitting={isSubmitting}
                                            onOpeningChange={handleOpeningChange}
                                            onOpeningLock={handleOpeningLock}
                                            onRestockChange={handleRestockChange}
                                            onInventoryChange={handleInventoryChange}
                                        />
                                    </>
                                )}

                                {activeTab === 'revenue' && (
                                    <RevenueInputCard
                                        actualCash={actualCash}
                                        actualTransfer={actualTransfer}
                                        isSubmitting={isSubmitting}
                                        onCashChange={handleCashChange}
                                        onTransferChange={handleTransferChange}
                                    />
                                )}

                                {activeTab === 'note' && (
                                    <NoteCard
                                        note={note}
                                        isSubmitting={isSubmitting}
                                        onChange={handleNoteChange}
                                    />
                                )}
                            </>
                        )}
                    </main>
                </>
            )}
        </div>
    )
}
