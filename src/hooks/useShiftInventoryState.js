import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
    fetchTodayShiftClosing,
    fetchIngredientCostsWithUnits,
    fetchIngredientStocks,
} from '../services/orderService'
import { supabase } from '../lib/supabaseClient'
import { isGuest } from '../services/localRepository'
import { sortIngredients } from '../utils/ingredients'
import { dateStringVN } from '../utils/dateVN'

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
// `dateKey` (e.g. todayISO from caller) is part of the effect deps so an overnight
// session detecting a date change clears stale inputs and refetches the new day's
// shift_closing instead of editing yesterday's row.
export function useShiftInventoryState(addressId, ingredientSortOrder, dateKey) {
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

    // Dirty is DERIVED from a baseline snapshot (last loaded / last saved values).
    // The old boolean flag stuck at true after a revert because nothing knew
    // current state had returned to baseline; comparing maps each render fixes that.
    const baselineRef = useRef({ opening: {}, openingLocked: {}, restock: {}, inventory: {} })
    const [baselineVersion, setBaselineVersion] = useState(0)
    const commitBaseline = useCallback((opening, openingLocked, restock, inventory) => {
        baselineRef.current = {
            opening: { ...opening },
            openingLocked: { ...openingLocked },
            restock: { ...restock },
            inventory: { ...inventory },
        }
        setBaselineVersion(v => v + 1)
    }, [])

    const channelRef = useRef(null)

    // ── Load existing shift closing → seed input maps ─────────────────────────
    // Re-runs when dateKey changes (midnight rollover) to drop stale yesterday inputs.
    useEffect(() => {
        if (!addressId) { setIsLoadingExisting(false); return }
        setIsLoadingExisting(true)
        // Clear pre-existing input state so a new day starts blank if no closing exists yet.
        setExistingClosing(null)
        setInventoryInputs({})
        setRestockInputs({})
        setOpeningInputs({})
        setOpeningLocked({})
        commitBaseline({}, {}, {}, {})
        fetchTodayShiftClosing(addressId).then(data => {
            if (!data) return
            // Guard against server returning yesterday's row as "today's" (tz / RPC
            // boundary issue). When closed_at isn't today VN, ignore — treat as no
            // existing closing so save creates a fresh row instead of updating yesterday.
            const isToday = !dateKey
                || (data.closed_at && dateStringVN(new Date(data.closed_at)) === dateKey)
            if (!isToday) return
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
            // Snapshot baseline = whatever just got hydrated from the existing closing.
            commitBaseline(openings, locked, restocks, inputs)
        }).finally(() => setIsLoadingExisting(false))
    }, [addressId, dateKey, commitBaseline])

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
                ; (rows || []).forEach(r => {
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
            // When seeding kicks in, also fold the seed into baseline.opening so
            // a fresh tab doesn't read as "dirty" before any user edit.
            setOpeningInputs(prev => {
                if (Object.keys(prev).length > 0) return prev
                baselineRef.current = { ...baselineRef.current, opening: { ...openings } }
                setBaselineVersion(v => v + 1)
                return openings
            })
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
            // Loại nguyên liệu được tắt "kiểm kê hao hụt" (count_in_audit === false).
            // Thiếu cờ (phiếu cũ / chưa migrate) → mặc định hiện.
            const sorted = [...list]
                .filter(r => r.count_in_audit !== false)
                .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, ingredientSortOrder))
            setIngredientsList(sorted)
        }).finally(() => setIsLoadingIngredients(false))
    }, [addressId, ingredientSortOrder])

    // ── Realtime broadcast: sync input edits across devices ──────────────────
    useEffect(() => {
        // Guests are local-only and ALL share the same demo address id, so they'd all
        // join one channel (`shift-closing-demo-address-uuid-123`) and leak each other's
        // keystrokes. Skip Realtime entirely for guests.
        if (!addressId || !supabase || isGuest()) return
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

    // ── Mutation handlers (broadcast; dirty is derived) ──────────────────────
    const onOpeningChange = useCallback((ingredient, value) => {
        setOpeningInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'opening', ingredient, value })
    }, [broadcast])

    const onOpeningLock = useCallback((ingredient, locked) => {
        setOpeningLocked(prev => ({ ...prev, [ingredient]: locked }))
        broadcast({ type: 'openingLocked', ingredient, value: locked })
    }, [broadcast])

    const onRestockChange = useCallback((ingredient, value) => {
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'restock', ingredient, value })
    }, [broadcast])

    const onInventoryChange = useCallback((ingredient, value) => {
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
        broadcast({ type: 'inventory', ingredient, value })
    }, [broadcast])

    // ── Derived: isDirty (compare inputs vs baseline) ────────────────────────
    // Empty string and undefined both mean "no input" — normalize so a load that
    // hydrates "" → never sees a phantom diff against undefined baseline keys.
    const isDirty = useMemo(() => {
        const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v))
        const mapEq = (a, b) => {
            const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
            for (const k of keys) if (norm(a?.[k]) !== norm(b?.[k])) return false
            return true
        }
        const b = baselineRef.current
        return !(
            mapEq(openingInputs, b.opening)
            && mapEq(openingLocked, b.openingLocked)
            && mapEq(restockInputs, b.restock)
            && mapEq(inventoryInputs, b.inventory)
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openingInputs, openingLocked, restockInputs, inventoryInputs, baselineVersion])

    // Save handlers call this after a successful save so current inputs become
    // the new baseline → button hides again, ready for the next edit.
    const resetDirty = useCallback(() => {
        commitBaseline(openingInputs, openingLocked, restockInputs, inventoryInputs)
    }, [commitBaseline, openingInputs, openingLocked, restockInputs, inventoryInputs])

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
    // Empty inputs are preserved as `null`, NOT coerced to 0 — a blank "+ Cuối kỳ"
    // means "staff didn't count this ingredient at end of shift", not "0g remaining".
    // Audit cards must skip diff calc for null `remaining` so they don't surface
    // a fake hao hụt equal to the whole theoretical stock.
    const parseOrNull = (v) => (v === undefined || v === '' ? null : Number(v))
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
                opening: parseOrNull(openingInputs[ing.ingredient]),
                opening_locked: openingLocked[ing.ingredient] || false,
                remaining: parseOrNull(inventoryInputs[ing.ingredient]),
                restock: parseOrNull(restockInputs[ing.ingredient]),
            }))
    }, [ingredientsList, inventoryInputs, restockInputs, openingInputs, openingLocked])

    // Snapshot of the last-committed baseline, refreshed whenever baselineVersion bumps.
    // Sort + collapse logic on InventoryReportCard reads from this so live keystrokes
    // don't re-order rows mid-edit — only load / save / lock events shift the layout.
    const baselineSnapshot = useMemo(() => ({
        opening: baselineRef.current.opening,
        openingLocked: baselineRef.current.openingLocked,
        restock: baselineRef.current.restock,
        inventory: baselineRef.current.inventory,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [baselineVersion])

    return {
        // raw input maps
        openingInputs, openingLocked, restockInputs, inventoryInputs,
        // fetched / derived
        ingredientsList, isLoadingIngredients,
        openingStock, warehouseStocks, effectiveWarehouseStocks,
        existingClosing, setExistingClosing,
        isLoadingExisting,
        restockOverflowIngredients,
        // dirty tracking (derived from baseline comparison; resetDirty after save)
        isDirty, resetDirty,
        // last-persisted snapshot (bumps on load / save / lock) — used by the card to
        // sort and to remount rows so they auto-collapse after a successful save.
        baselineSnapshot, baselineVersion,
        // handlers
        onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
        // save helpers
        buildInventoryReport,
    }
}
