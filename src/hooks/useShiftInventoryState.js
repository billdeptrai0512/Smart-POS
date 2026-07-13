import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
    fetchTodayShiftClosing,
    fetchIngredientCostsWithUnits,
    fetchIngredientStocks,
} from '../services/orderService'
import { mergeShiftClosingInventory, fetchYesterdayShiftClosing } from '../services/reportService'
import { supabase } from '../lib/supabaseClient'
import { isGuest } from '../services/localRepository'
import { countActiveSessions } from '../services/authService'
import { sortIngredients, lookupByLabel } from '../utils/ingredients'
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

    // Mirror refs of the live input maps so reconcileFromRemote can merge synchronously
    // (without putting side-effects inside state updaters). Refreshed every render.
    const openingInputsRef = useRef(openingInputs); openingInputsRef.current = openingInputs
    const openingLockedRef = useRef(openingLocked); openingLockedRef.current = openingLocked
    const restockInputsRef = useRef(restockInputs); restockInputsRef.current = restockInputs
    const inventoryInputsRef = useRef(inventoryInputs); inventoryInputsRef.current = inventoryInputs

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
            // Đầu kỳ: nếu phiếu KHÔNG lưu opening (vd chỉ nhập Cuối kỳ), đừng reset baseline.opening
            // về {} — reloadStocks có thể đã seed openingInputs từ hôm qua. Reset sẽ khiến
            // input(seed) ≠ baseline({}) ⇒ phantom-dirty (FAB Lưu + chặn thoát) dù chưa gõ gì.
            // Giữ seed đang có trong baseline để 2 thứ khớp ở cả 2 thứ tự resolve của race.
            const openBase = Object.keys(openings).length ? openings : baselineRef.current.opening
            commitBaseline(openBase, locked, restocks, inputs)
        }).finally(() => setIsLoadingExisting(false))
    }, [addressId, dateKey, commitBaseline])

    // ── Canonical stock reader: warehouse + counter snapshots ────────────────
    // counter_stock seeds "Đầu kỳ" (= previous shift's remaining).
    // warehouse_stock is shown alongside each row and used to validate restock
    // input against the available kho tổng.
    // Refetches on tab visibility regain so a /ingredients → + Nhập kho mid-shift
    // reflects here without manual refresh.
    // Exposed so callers can refresh after writing stock (e.g. Nhập kho từ /daily-report)
    // — the warehouse balances then reflect the new purchase without a tab switch.
    const reloadStocks = useCallback(() => {
        if (!addressId) return Promise.resolve()
        return Promise.all([
            fetchIngredientStocks(addressId),
            fetchYesterdayShiftClosing(addressId),
        ]).then(([rows, yesterdayClosing]) => {
            const warehouses = {}
            ; (rows || []).forEach(r => {
                if (typeof r.warehouse_stock === 'number') {
                    warehouses[r.ingredient] = r.warehouse_stock
                }
            })
            setWarehouseStocks(warehouses)

            let yesterdayReport = []
            if (yesterdayClosing && yesterdayClosing.inventory_report) {
                yesterdayReport = yesterdayClosing.inventory_report
                if (typeof yesterdayReport === 'string') {
                    try { yesterdayReport = JSON.parse(yesterdayReport) } catch { yesterdayReport = [] }
                }
            }

            const counters = {}, openings = {}
            if (Array.isArray(yesterdayReport)) {
                yesterdayReport.forEach(item => {
                    if (item && item.ingredient && typeof item.remaining === 'number') {
                        counters[item.ingredient] = item.remaining
                        openings[item.ingredient] = String(item.remaining)
                    }
                })
            }

            setOpeningStock(counters)
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
    }, [addressId])

    useEffect(() => {
        if (!addressId) return
        reloadStocks()
        const onVis = () => { if (document.visibilityState === 'visible') reloadStocks() }
        document.addEventListener('visibilitychange', onVis)
        return () => document.removeEventListener('visibilitychange', onVis)
    }, [addressId, reloadStocks])

    // ── Ingredient list with units (for sort + per-row metadata) ─────────────
    // Exposed (như reloadStocks) để refresh sau khi Nhập kho làm đổi giá vốn bình quân —
    // cột "Giá trị" hao hụt (= lượng × unit_cost) mới tươi mà không cần vào lại trang.
    const reloadIngredients = useCallback(() => {
        if (!addressId) { setIsLoadingIngredients(false); return Promise.resolve() }
        setIsLoadingIngredients(true)
        return fetchIngredientCostsWithUnits(addressId).then(list => {
            // Loại nguyên liệu được tắt "kiểm kê hao hụt" (count_in_audit === false).
            // Thiếu cờ (phiếu cũ / chưa migrate) → mặc định hiện.
            const sorted = [...list]
                .filter(r => r.count_in_audit !== false)
                .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, ingredientSortOrder))
            setIngredientsList(sorted)
        }).finally(() => setIsLoadingIngredients(false))
    }, [addressId, ingredientSortOrder])

    useEffect(() => { reloadIngredients() }, [reloadIngredients])

    // ── Remote merge: fold another device's saved inventory_report into local maps ──
    // Per-field rule: if the local field is dirty (≠ baseline → user is editing it now),
    // KEEP local — don't yank the number they're typing; it'll get pushed on next autosave.
    // Otherwise adopt the remote value (absent in remote = cleared) AND advance baseline to
    // it, so isDirty stays false (no autosave loop). The DB row is the full authoritative
    // array, so "absent" genuinely means another device deleted/cleared that ingredient.
    const reconcileFromRemote = useCallback((remoteReport) => {
        let parsed = remoteReport
        if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return } }
        if (!Array.isArray(parsed)) return
        const rOpening = {}, rLocked = {}, rRestock = {}, rInventory = {}
        parsed.forEach(item => {
            if (!item || !item.ingredient) return
            if (typeof item.opening === 'number') rOpening[item.ingredient] = String(item.opening)
            if (item.opening_locked) rLocked[item.ingredient] = true
            if (typeof item.restock === 'number') rRestock[item.ingredient] = String(item.restock)
            if (typeof item.remaining === 'number') rInventory[item.ingredient] = String(item.remaining)
        })
        const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v))
        // eq: how to compare a field for "dirty" and "present" — strings for inputs, bool for lock.
        const mergeField = (prevMap, baseMap, remoteMap, eq, present) => {
            const out = {}, nb = {}
            const keys = new Set([...Object.keys(prevMap), ...Object.keys(baseMap), ...Object.keys(remoteMap)])
            for (const k of keys) {
                const dirty = eq(prevMap[k]) !== eq(baseMap[k])
                if (dirty) {
                    if (present(prevMap[k])) out[k] = prevMap[k]
                    if (present(baseMap[k])) nb[k] = baseMap[k]   // keep stale baseline → stays dirty → re-pushed
                } else if (present(remoteMap[k])) {
                    out[k] = remoteMap[k]; nb[k] = remoteMap[k]
                }
            }
            return [out, nb]
        }
        const strEq = (v) => norm(v), strPresent = (v) => norm(v) !== null
        const boolEq = (v) => !!v, boolPresent = (v) => !!v
        const b = baselineRef.current
        const [oOut, oNb] = mergeField(openingInputsRef.current, b.opening, rOpening, strEq, strPresent)
        const [lOut, lNb] = mergeField(openingLockedRef.current, b.openingLocked, rLocked, boolEq, boolPresent)
        const [rOut, rNb] = mergeField(restockInputsRef.current, b.restock, rRestock, strEq, strPresent)
        const [iOut, iNb] = mergeField(inventoryInputsRef.current, b.inventory, rInventory, strEq, strPresent)
        setOpeningInputs(oOut); setOpeningLocked(lOut); setRestockInputs(rOut); setInventoryInputs(iOut)
        baselineRef.current = { opening: oNb, openingLocked: lNb, restock: rNb, inventory: iNb }
        setBaselineVersion(v => v + 1)
    }, [])

    // ── Gate: only open the realtime channel below when >= 2 devices are active
    // on this address (same pattern as POSContext's orders-realtime). A single
    // device editing its own shift has no one to sync with — opening a channel
    // for every solo session was needless connection load at scale.
    const [hasMultiDevice, setHasMultiDevice] = useState(false)
    useEffect(() => {
        if (!addressId || isGuest()) return
        let cancelled = false
        const check = () => countActiveSessions(addressId).then(count => {
            if (!cancelled) setHasMultiDevice(count >= 2)
        })
        check()
        const interval = setInterval(check, 5 * 60 * 1000)
        return () => { cancelled = true; clearInterval(interval) }
    }, [addressId])

    // ── Realtime: subscribe to this address's shift_closings rows ─────────────
    // Replaces the old ephemeral broadcast (no replay, dropped packets = permanent
    // desync). Each device autosaves its edits (light merge RPC); postgres_changes pushes
    // the merged row to the other device → reconcileFromRemote converges them.
    // Guests are local-only and share one demo address id → skip Realtime entirely.
    useEffect(() => {
        if (!addressId || !supabase || isGuest() || !hasMultiDevice) return
        const channel = supabase
            .channel(`shift-closing-db-${addressId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'shift_closings', filter: `address_id=eq.${addressId}` },
                (payload) => {
                    const row = payload.new
                    if (!row || !row.inventory_report) return
                    // Only today's (VN) row — ignore events for other days' closings.
                    if (dateKey && row.closed_at && dateStringVN(new Date(row.closed_at)) !== dateKey) return
                    reconcileFromRemote(row.inventory_report)
                })
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [addressId, dateKey, reconcileFromRemote, hasMultiDevice])

    // ── Mutation handlers (plain setState; dirty is derived, autosave pushes) ─
    const onOpeningChange = useCallback((ingredient, value) => {
        setOpeningInputs(prev => ({ ...prev, [ingredient]: value }))
    }, [])

    const onOpeningLock = useCallback((ingredient, locked) => {
        setOpeningLocked(prev => ({ ...prev, [ingredient]: locked }))
    }, [])

    const onRestockChange = useCallback((ingredient, value) => {
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
    }, [])

    const onInventoryChange = useCallback((ingredient, value) => {
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
    }, [])

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

    // Danh sách field đã đổi so với baseline, dạng người-đọc-được — để confirm "rời trang"
    // chú thích cụ thể thay đổi nào sắp mất (thay vì câu chung chung gây mơ hồ khi user
    // nghĩ mình chưa đổi gì). Mỗi dòng: "Nguyên liệu · Loại: cũ → mới".
    const dirtySummary = useMemo(() => {
        const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v))
        const fmt = (v) => (v == null ? '(trống)' : v)
        const b = baselineRef.current
        const lines = []
        const fields = [
            ['Đầu kỳ', openingInputs, b.opening],
            ['Cuối kỳ', inventoryInputs, b.inventory],
            ['Lấy ra', restockInputs, b.restock],
        ]
        for (const [label, cur, base] of fields) {
            for (const ing of new Set([...Object.keys(cur || {}), ...Object.keys(base || {})])) {
                if (norm(cur[ing]) !== norm(base[ing]))
                    lines.push(`${ing} · ${label}: ${fmt(norm(base[ing]))} → ${fmt(norm(cur[ing]))}`)
            }
        }
        for (const ing of new Set([...Object.keys(openingLocked || {}), ...Object.keys(b.openingLocked || {})])) {
            if (!!openingLocked[ing] !== !!b.openingLocked[ing])
                lines.push(`${ing} · Khoá đầu kỳ: ${openingLocked[ing] ? 'bật' : 'tắt'}`)
        }
        return lines
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openingInputs, inventoryInputs, restockInputs, openingLocked, baselineVersion])

    // Restock có đổi so với baseline không. Lưu có restock thay đổi = chuyển kho ra quầy
    // (trừ kho tổng server-side) → cần confirm; lưu chỉ-đếm (Đầu/Cuối kỳ) thì không.
    const restockDirty = useMemo(() => {
        const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v))
        const a = restockInputs, b = baselineRef.current.restock || {}
        const keys = new Set([...Object.keys(a || {}), ...Object.keys(b)])
        for (const k of keys) if (norm(a?.[k]) !== norm(b[k])) return true
        return false
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restockInputs, baselineVersion])

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
            // Tra kèm fallback theo label (giống warehousePrepList) — nếu chỉ tra key trực tiếp,
            // NVL lưu key biến thể sẽ ra undefined → bỏ qua guard → restock vượt kho lọt qua,
            // server clamp warehouse về 0. Dùng undefined làm "không theo dõi kho" (bỏ kiểm).
            const avail = lookupByLabel(ing.ingredient, effectiveWarehouseStocks, undefined)
            if (avail !== undefined && r > Number(avail || 0)) list.push(ing.ingredient)
        }
        return list
    }, [ingredientsList, restockInputs, effectiveWarehouseStocks])

    // Empty inputs are preserved as `null`, NOT coerced to 0 — a blank "+ Cuối kỳ"
    // means "staff didn't count this ingredient at end of shift", not "0g remaining".
    // Audit cards must skip diff calc for null `remaining` so they don't surface
    // a fake hao hụt equal to the whole theoretical stock. (null remaining + null restock
    // + null opening = tombstone → merge RPC removes the ingredient.)
    const parseOrNull = (v) => (v === undefined || v === '' ? null : Number(v))

    // Delta vs baseline — only the ingredients THIS device changed, for the light merge RPC.
    // An ingredient cleared back to empty emits an all-null entry → RPC treats it as a
    // tombstone and removes it. Sending only the delta is what makes the merge race-free:
    // two devices editing different ingredients never touch each other's entries.
    const buildInventoryPatches = useCallback(() => {
        const norm = (v) => (v === undefined || v === null || v === '' ? null : String(v))
        const unitOf = {}
        ingredientsList.forEach(i => { unitOf[i.ingredient] = i.unit || 'đv' })
        const b = baselineRef.current
        const keys = new Set([
            ...Object.keys(openingInputs), ...Object.keys(inventoryInputs),
            ...Object.keys(restockInputs), ...Object.keys(openingLocked),
            ...Object.keys(b.opening), ...Object.keys(b.inventory),
            ...Object.keys(b.restock), ...Object.keys(b.openingLocked),
        ])
        const patches = []
        for (const ing of keys) {
            const changed =
                norm(openingInputs[ing]) !== norm(b.opening[ing])
                || norm(inventoryInputs[ing]) !== norm(b.inventory[ing])
                || norm(restockInputs[ing]) !== norm(b.restock[ing])
                || !!openingLocked[ing] !== !!b.openingLocked[ing]
            if (!changed) continue
            patches.push({
                ingredient: ing,
                unit: unitOf[ing] || 'đv',
                opening: parseOrNull(openingInputs[ing]),
                opening_locked: !!openingLocked[ing],
                remaining: parseOrNull(inventoryInputs[ing]),
                restock: parseOrNull(restockInputs[ing]),
            })
        }
        return patches
        // baselineVersion bumps the baselineRef snapshot used above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ingredientsList, inventoryInputs, restockInputs, openingInputs, openingLocked, baselineVersion])

    // ── Light autosave push: send this device's delta, merge server-side, converge ──
    // Advances baseline ONLY for the fields we just pushed → they read non-dirty (no re-push
    // loop); fields typed *after* the snapshot stay dirty and push next cycle.
    // We deliberately do NOT reconcile the RPC RESPONSE row: its HTTP reply can arrive out of
    // order vs the realtime echo, and a stale snapshot (missing a field the other device just
    // added) would wrongly clear it. The authoritative fold/clear of the other device's edits
    // comes from the ORDERED postgres_changes echo (our own UPDATE is delivered back too).
    const pushingRef = useRef(false)
    const pushInventory = useCallback(async (closedBy, systemTotalRevenue) => {
        if (pushingRef.current) return null   // an earlier push still in flight → skip; isDirty stays true → retried
        const patches = buildInventoryPatches()
        if (!patches.length) return null
        pushingRef.current = true
        try {
            const row = await mergeShiftClosingInventory(addressId, patches, closedBy, systemTotalRevenue)
            if (!row) return null
            // Pushed values → baseline (so they read non-dirty); tombstones (all null) drop the key.
            const b = baselineRef.current
            const opening = { ...b.opening }, openingLocked = { ...b.openingLocked }
            const restock = { ...b.restock }, inventory = { ...b.inventory }
            for (const p of patches) {
                const k = p.ingredient
                if (p.opening == null) delete opening[k]; else opening[k] = String(p.opening)
                if (!p.opening_locked) delete openingLocked[k]; else openingLocked[k] = true
                if (p.restock == null) delete restock[k]; else restock[k] = String(p.restock)
                if (p.remaining == null) delete inventory[k]; else inventory[k] = String(p.remaining)
            }
            baselineRef.current = { opening, openingLocked, restock, inventory }
            setBaselineVersion(v => v + 1)   // recompute isDirty against advanced baseline
            setExistingClosing(row)
            return row
        } finally {
            pushingRef.current = false
        }
    }, [addressId, buildInventoryPatches])

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
        openingStock, warehouseStocks, effectiveWarehouseStocks, reloadStocks, reloadIngredients,
        existingClosing, setExistingClosing,
        isLoadingExisting,
        restockOverflowIngredients,
        // dirty tracking (derived from baseline comparison; baseline advances on push/remote merge)
        isDirty, restockDirty, dirtySummary,
        // last-persisted snapshot (bumps on load / save / lock) — used by the card to
        // sort and to remount rows so they auto-collapse after a successful save.
        baselineSnapshot, baselineVersion,
        // handlers
        onOpeningChange, onOpeningLock, onRestockChange, onInventoryChange,
        // save helpers
        pushInventory,
    }
}
