import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePOS } from '../contexts/POSContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { getPendingOrders } from '../hooks/useOfflineSync'
import { fetchTodayShiftClosing, fetchIngredientCostsWithUnits, fetchIngredientStocks } from '../services/orderService'
import { useShiftClosingSave } from '../hooks/useShiftClosingSave'
import { dateStringVN } from '../utils/dateVN'
import { supabase } from '../lib/supabaseClient'
import { sortIngredients } from '../components/common/recipeUtils'
import { useToast } from '../hooks/useToast'
import { useEntitlement, hasFeature } from '../hooks/useEntitlement'
import Toast from '../components/POSPage/Toast'
import UpsellPage from '../components/common/UpsellPage'
import ShiftClosingHeader from '../components/ShiftClosingPage/ShiftClosingHeader'
import InventoryReportCard from '../components/ShiftClosingPage/InventoryReportCard'

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

    const [isDirty, setIsDirty] = useState(false)
    const [showPaywall, setShowPaywall] = useState(false)
    const [existingClosing, setExistingClosing] = useState(null)
    const [isLoadingExisting, setIsLoadingExisting] = useState(true)
    const { save: saveShiftClosing, isSaving } = useShiftClosingSave(selectedAddress?.id)

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

    // Load existing shift closing (for editing). Cash/transfer/note live on the row but are
    // edited from /daily-report now — we read inventory_report only and forward the rest
    // untouched on save.
    useEffect(() => {
        if (!selectedAddress?.id) { setIsLoadingExisting(false); return }
        setIsLoadingExisting(true)
        fetchTodayShiftClosing(selectedAddress.id).then(data => {
            if (!data) return
            setExistingClosing(data)

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
                // actualCash / actualTransfer / note are now edited from /daily-report —
                // intentionally not synced here.
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

    // When editing an already-saved shift, `warehouseStocks` from fetchIngredientStocks
    // has already subtracted this shift's restock (it's part of Σ restocks). Add it back
    // so validation compares the new restock input against the warehouse balance
    // *before* this shift's restock — otherwise a no-op edit triggers a false "Vượt kho".
    const effectiveWarehouseStocks = useMemo(() => {
        if (!existingClosing) return warehouseStocks
        let parsed = existingClosing.inventory_report
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed) } catch { return warehouseStocks }
        }
        if (!Array.isArray(parsed)) return warehouseStocks
        const adjusted = { ...warehouseStocks }
        parsed.forEach(item => {
            if (typeof item.restock === 'number' && item.ingredient) {
                adjusted[item.ingredient] = (adjusted[item.ingredient] || 0) + item.restock
            }
        })
        return adjusted
    }, [warehouseStocks, existingClosing])

    // --- System total revenue ---
    const pending = getPendingOrders()
    const todayStr = dateStringVN()
    const offlineToday = pending.filter(o => dateStringVN(new Date(o.createdAt)) === todayStr)
    let systemTotalRevenue = 0
    todayOrders.forEach(o => { if (!o.deleted_at && !o.deletedAt) systemTotalRevenue += o.total })
    offlineToday.forEach(o => { if (!o.deleted_at && !o.deletedAt) systemTotalRevenue += o.total })

    // --- Change handlers ---
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

    // Any row where the typed restock exceeds the warehouse available for THIS shift.
    // Submitting through this would clamp warehouse_stock to 0 on the server and corrupt
    // the daily-context "tồn đầu" math on /ingredients — so we block submit on overflow.
    const restockOverflowIngredients = useMemo(() => {
        const list = []
        for (const ing of ingredientsList) {
            const r = Number(restockInputs[ing.ingredient] || 0)
            const avail = effectiveWarehouseStocks[ing.ingredient]
            if (avail !== undefined && r > Number(avail || 0)) list.push(ing.ingredient)
        }
        return list
    }, [ingredientsList, restockInputs, effectiveWarehouseStocks])

    const handleSubmit = async () => {
        if (isSaving) return

        // Block submit when any row reports more restock than the warehouse can supply.
        if (restockOverflowIngredients.length > 0) {
            window.alert(`Không thể chốt ca: ${restockOverflowIngredients.length} nguyên liệu có "Nhập thêm" vượt quá kho tổng. Vào /ingredients → + Nhập kho trước, hoặc giảm số "Nhập thêm" lại.`)
            return
        }

        // Confirm before committing — chốt ca is a coarse action and not easily reversible.
        if (!window.confirm(existingClosing?.id ? 'Cập nhật báo cáo ca?' : 'Xác nhận chốt ca?')) return

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

            // Cash / transfer / note are owned by /daily-report now — only include them in
            // the insert payload so the column has a defined default on first close. Updates
            // omit them so /daily-report's edits aren't clobbered.
            const payload = {
                address_id: selectedAddress?.id,
                inventory_report: inventoryReport,
            }
            if (!existingClosing?.id) {
                payload.closed_by = profile?.id || null
                payload.system_total_revenue = systemTotalRevenue
                payload.actual_cash = 0
                payload.actual_transfer = 0
                payload.note = ''
            }

            await saveShiftClosing(payload, {
                existingId: existingClosing?.id,
                onFixedCostError: (err) => showError(err, 'Ghi chi phí cố định vào ca'),
            })

            setIsDirty(false)
            if (hasFeature(activeModules, 'reports')) {
                // Land on the inventory view — the only thing /shift-closing edits now.
                navigate('/daily-report', { replace: true, state: { initialView: 'inventory' } })
            } else {
                // Paywall path: stay on page. Refresh existingClosing so subsequent edits
                // recompute effectiveWarehouseStocks against the just-saved restock values.
                const fresh = await fetchTodayShiftClosing(selectedAddress?.id)
                if (fresh) setExistingClosing(fresh)
                setShowPaywall(true)
            }
        } catch (err) {
            showError(err, 'Chốt ca')
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
                        isSubmitting={isSaving}
                        isDisabled={isSaving || isLoadingHistory || isLoadingIngredients || isLoadingExisting}
                        onBack={handleBack}
                        onSubmit={handleSubmit}
                    />

                    <main className="flex-1 overflow-y-auto px-4 py-5 space-y-5 bg-bg">
                        {isLoadingHistory ? (
                            <div className="flex flex-col gap-3 animate-pulse">
                                <div className="bg-surface-light rounded-[20px] h-24 w-full" />
                                <div className="bg-surface-light rounded-[20px] h-40 w-full" />
                            </div>
                        ) : (
                            <InventoryReportCard
                                ingredientsList={ingredientsList}
                                isLoading={isLoadingIngredients}
                                openingStock={openingStock}
                                openingInputs={openingInputs}
                                openingLocked={openingLocked}
                                restockInputs={restockInputs}
                                inventoryInputs={inventoryInputs}
                                warehouseStocks={effectiveWarehouseStocks}
                                ingredientUnits={Object.fromEntries(ingredientsList.map(i => [i.ingredient, i.unit]))}
                                canUnlock={canUnlock}
                                isSubmitting={isSaving}
                                onOpeningChange={handleOpeningChange}
                                onOpeningLock={handleOpeningLock}
                                onRestockChange={handleRestockChange}
                                onInventoryChange={handleInventoryChange}
                            />
                        )}
                    </main>
                </>
            )}
        </div>
    )
}
