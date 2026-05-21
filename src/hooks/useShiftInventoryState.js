import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
    fetchTodayShiftClosing,
    fetchIngredientCostsWithUnits,
    fetchIngredientStocks,
} from '../services/orderService'
import { supabase } from '../lib/supabaseClient'
import { sortIngredients } from '../components/common/recipeUtils'

// Owns all the inventory-side state and side-effects that used to live in
// ShiftClosingPage: input maps for opening / restock / counter, the existing
// shift_closing row, the canonical warehouse balances, and the Realtime
// broadcast that keeps two staff on the same shift in sync.
//
// Returns everything DailyReportPage needs to render InventoryReportCard
// and build an inventory_report payload for save.
//
// Realtime channel is named after the address (same as before) so devices
// editing the same shift converge regardless of which page they're on.
export function useShiftInventoryState(addressId, ingredientSortOrder) {
    // ── Inputs (staff-typed) ──────────────────────────────────────────────────
    const [openingInputs, setOpeningInputs] = useState({})
    const [openingLocked, setOpeningLocked] = useState({})
    const [restockInputs, setRestockInputs] = useState({})
    const [inventoryInputs, setInventoryInputs] = useState({})

    // ── Derived / fetched ─────────────────────────────────────────────────────
    const [ingredientsList, setIngredientsList] = useState([])
    const [isLoadingIngredients, setIsLoadingIngredients] = useState(true)
    const [openingStock, setOpeningStock] = useState({})
    const [warehouseStocks, setWarehouseStocks] = useState({})
    const [existingClosing, setExistingClosing] = useState(null)
    const [isLoadingExisting, setIsLoadingExisting] = useState(true)
    const [isDirty, setIsDirty] = useState(false)

    const channelRef = useRef(null)

    // ── Load existing shift closing → seed input maps ─────────────────────────
    useEffect(() => {
        if (!addressId) { setIsLoadingExisting(false); return }
        setIsLoadingExisting(true)
        fetchTodayShiftClosing(addressId).then(data => {
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
    }, [addressId])

    // ── Canonical stock reader: warehouse + counter snapshots ────────────────
    // counter_stock seeds "Đầu kỳ" (= previous shift's remaining).
    // warehouse_stock is shown alongside each row and used to validate restock
    // input against the available kho tổng.
    // Refetches on tab visibility regain so a /ingredients → + Nhập kho mid-shift
    // reflects here without manual refresh.
    useEffect(() => {
        if (!addressId) return
        const load = () => fetchIngredientStocks(addressId).then(rows => {
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
            // Seed openingInputs only if today's closing hasn't set them yet.
            setOpeningInputs(prev => Object.keys(prev).length > 0 ? prev : openings)
        })
        load()
        const onVis = () => { if (document.visibilityState === 'visible') load() }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [addressId])

    // ── Ingredient list with units (for sort + per-row metadata) ─────────────
    useEffect(() => {
        if (!addressId) { setIsLoadingIngredients(false); return }
        setIsLoadingIngredients(true)
        fetchIngredientCostsWithUnits(addressId).then(list => {
            const sorted = [...list].sort((a, b) => sortIngredients(a.ingredient, b.ingredient, ingredientSortOrder))
            setIngredientsList(sorted)
        }).finally(() => setIsLoadingIngredients(false))
    }, [addressId, ingredientSortOrder])

    // ── Realtime broadcast: sync input edits across devices ──────────────────
    useEffect(() => {
        if (!addressId || !supabase) return
        const channel = supabase.channel(`shift-closing-${addressId}`, {
            config: { broadcast: { self: false } }
        })
        channel
            .on('broadcast', { event: 'sync-state' }, ({ payload }) => {
                if (payload.type === 'inventory') setInventoryInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }))
                if (payload.type === 'restock') setRestockInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }))
                if (payload.type === 'opening') setOpeningInputs(prev => ({ ...prev, [payload.ingredient]: payload.value }))
                if (payload.type === 'openingLocked') setOpeningLocked(prev => ({ ...prev, [payload.ingredient]: payload.value }))
            })
            .subscribe()
        channelRef.current = channel
        return () => { supabase.removeChannel(channel) }
    }, [addressId])

    const broadcast = useCallback((payload) => {
        channelRef.current?.send({ type: 'broadcast', event: 'sync-state', payload }).catch(() => { })
    }, [])

    // ── Mutation handlers (flip dirty + broadcast) ───────────────────────────
    const onOpeningChange = useCallback((ingredient, value) => {
        setIsDirty(true)
        setOpeningInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'opening', ingredient, value })
    }, [broadcast])

    const onOpeningLock = useCallback((ingredient, locked) => {
        setIsDirty(true)
        setOpeningLocked(prev => ({ ...prev, [ingredient]: locked }))
        broadcast({ type: 'openingLocked', ingredient, value: locked })
    }, [broadcast])

    const onRestockChange = useCallback((ingredient, value) => {
        setIsDirty(true)
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'restock', ingredient, value })
    }, [broadcast])

    const onInventoryChange = useCallback((ingredient, value) => {
        setIsDirty(true)
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'inventory', ingredient, value })
    }, [broadcast])

    // ── Derived: effective warehouse stocks ──────────────────────────────────
    // When editing an already-saved shift, `warehouseStocks` from fetchIngredientStocks
    // has already subtracted this shift's restock. Add it back so validation compares
    // the new restock input against the warehouse balance *before* this shift's
    // restock — otherwise a no-op edit triggers a false "Vượt kho".
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

    // ── Derived: restock-overflow detection ──────────────────────────────────
    // Any row where typed restock > kho tổng available. Submitting through this would
    // clamp warehouse_stock to 0 on the server and corrupt /ingredients tồn đầu math.
    const restockOverflowIngredients = useMemo(() => {
        const list = []
        for (const ing of ingredientsList) {
            const r = Number(restockInputs[ing.ingredient] || 0)
            const avail = effectiveWarehouseStocks[ing.ingredient]
            if (avail !== undefined && r > Number(avail || 0)) list.push(ing.ingredient)
        }
        return list
    }, [ingredientsList, restockInputs, effectiveWarehouseStocks])

    // ── Helper: build the inventory_report payload for save ──────────────────
    const buildInventoryReport = useCallback(() => {
        return ingredientsList
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
    }, [ingredientsList, inventoryInputs, restockInputs, openingInputs, openingLocked])

    return {
        // raw input maps
        openingInputs, openingLocked, restockInputs, inventoryInputs,
        // fetched / derived
        ingredientsList, isLoadingIngredients,
        openingStock, warehouseStocks, effectiveWarehouseStocks,
        existingClosing, setExistingClosing,
        isLoadingExisting,
        restockOverflowIngredients,
        // dirty tracking
        isDirty, setIsDirty,
        // handlers
        onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
        // save helpers
        buildInventoryReport,
    }
}
