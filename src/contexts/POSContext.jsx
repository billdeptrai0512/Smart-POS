import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchTodayStats, submitOrder, fetchTodayOrders, deleteOrder, updateOrderDiscount, fetchTodayExpenses, insertExpense, updateExpense, deleteExpense, fetchRecentOrders, invalidateDailyContext } from '../services/orderService'
import { upsertSession, countActiveSessions } from '../services/authService'
import { useOfflineSync, addPendingOrder } from '../hooks/useOfflineSync'
import { dateStringVN } from '../utils/dateVN'
import { calculateProductCost, computeDiscount } from '../utils'
import { useProducts } from './ProductContext'
import { useAddress } from './AddressContext'
import { useAuth } from './AuthContext'
import { Outlet } from 'react-router-dom'
import { useToast } from '../hooks/useToast'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { CartContext } from './CartContext'
import { StatsContext } from './StatsContext'
import { HistoryContext } from './HistoryContext'

function mergeFetchedOrders(prev, fetchedOrders) {
    // The optimistic row's id IS the real orders.id (client-generated in
    // doSubmit, sent straight to the RPC) — a fetched row with the same id
    // is the confirmed copy of that exact row, no heuristic matching needed.
    const fetchedIds = new Set(fetchedOrders.map(o => o.id))
    const stillPending = prev.filter(o => o._optimistic && !fetchedIds.has(o.id))
    return [...stillPending, ...fetchedOrders]
}

export function POSProvider() {
    const { products, recipes, ingredientCosts, extraIngredients, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const { profile, isGuest } = useAuth()
    const addressId = selectedAddress?.id

    const localOrderIds = useRef(new Set())
    const cartRef = useRef([])
    // Holds the currently-subscribed orders channel so doSubmit can broadcast a
    // nudge on it right after a successful insert — see the realtime effect below.
    const ordersChannelRef = useRef(null)

    // ---- Persisted State ----
    const loadLocalJSON = (key, fallback) => {
        try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : fallback }
        catch { return fallback }
    }

    const [cart, setCart] = useState(() => loadLocalJSON(STORAGE_KEYS.CART, []))
    const [activeCartItemId, setActiveCartItemId] = useState(null)
    // Per-order discount, ephemeral (resets after each confirm). type: 'percent' | 'amount'
    const [discount, setDiscount] = useState({ type: 'percent', value: 0 })
    const [enabledStickyExtraIds, setEnabledStickyExtraIds] = useState([])
    const [revenue, setRevenue] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.REVENUE)) || 0)
    const [totalCost, setTotalCost] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.TOTAL_COST)) || 0)
    const [cupsSold, setCupsSold] = useState(() => Number(localStorage.getItem(STORAGE_KEYS.CUPS)) || 0)
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    // Gate for the orders-realtime channel below: true once >= 2 devices are active
    // on this address (nothing to sync cross-device with just 1). Kept up to date
    // by the heartbeat effect further down ("Heartbeat for active_sessions").
    const [hasMultiDevice, setHasMultiDevice] = useState(false)
    const { toast, showToast, showError } = useToast()

    // ---- History State ----
    const [todayOrders, setTodayOrders] = useState([])
    const historyFetchedRef = useRef({ addressId: null, at: 0 }) // last successful handleLoadHistory fetch
    const [todayExpenses, setTodayExpenses] = useState([])
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)
    // Order ids that just arrived from ANOTHER device (set in scheduleOrdersRefresh
    // below), so /history can glow those rows briefly — otherwise a realtime-merged
    // row looks identical to one that's been sitting there all along.
    const [justArrivedIds, setJustArrivedIds] = useState(() => new Set())
    // Last few orders, newest first (max 3) — shown in the header "Nhật ký" card.
    const [recentOrders, setRecentOrders] = useState([])
    // createdAt of the row that should play the slide-in. Set only on a local
    // commit so the realtime DB echo (which refetches with a different server
    // timestamp → different key → remount) can't replay the animation.
    const [enterKey, setEnterKey] = useState(null)

    // ---- Offline sync ----
    const handleSyncComplete = useCallback(() => {
        if (!addressId) return
        fetchTodayStats(addressId).then(({ revenue, cups }) => { setRevenue(revenue); setCupsSold(cups) })
        showToast('Đã đồng bộ đơn hàng offline!', 'success')
    }, [addressId, showToast])

    const { getPendingCount, retrySync } = useOfflineSync(handleSyncComplete)

    // ---- Load data when address changes ----
    useEffect(() => {
        if (!addressId) return

        async function load() {
            try {
                const [{ revenue: rev, cups }, recent] = await Promise.all([
                    fetchTodayStats(addressId),
                    fetchRecentOrders(addressId, 3)
                ])
                setRecentOrders(recent.map(buildLastOrderFromDB))
                if (supabase) {
                    setRevenue(rev)
                    setCupsSold(cups)
                }
            } catch (error) {
                showError(error, 'Tải dữ liệu hôm nay')
            }
        }
        load()
    }, [addressId, showError])

    // ---- Online/offline status ----
    useEffect(() => {
        const onOnline = () => setIsOnline(true)
        const onOffline = () => setIsOnline(false)
        window.addEventListener('online', onOnline)
        window.addEventListener('offline', onOffline)
        return () => {
            window.removeEventListener('online', onOnline)
            window.removeEventListener('offline', onOffline)
        }
    }, [])

    // ---- Auto-Reset New Day ----
    useEffect(() => {
        const checkNewDay = () => {
            const storedDate = localStorage.getItem(STORAGE_KEYS.CURRENT_DATE)
            const todayStr = dateStringVN()
            if (storedDate && storedDate !== todayStr) {
                if (navigator.onLine && supabase && addressId) {
                    fetchTodayStats(addressId).then(({ revenue, cups }) => { setRevenue(revenue); setCupsSold(cups) })
                    setTotalCost(0)
                    showToast('Đã qua ngày mới, dữ liệu đã được làm mới!', 'info')
                } else {
                    setRevenue(0)
                    setCupsSold(0)
                    setTotalCost(0)
                }
                localStorage.setItem(STORAGE_KEYS.CURRENT_DATE, todayStr)
            } else if (!storedDate) {
                localStorage.setItem(STORAGE_KEYS.CURRENT_DATE, todayStr)
            }
        }

        window.addEventListener('focus', checkNewDay)
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') checkNewDay()
        }
        window.addEventListener('visibilitychange', handleVisibility)

        return () => {
            window.removeEventListener('focus', checkNewDay)
            window.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [addressId, showToast])

    // ---- Supabase realtime subscriptions ----
    // Only subscribe to orders channel; only when tab is visible. Expenses are
    // refetched on visibilitychange instead of via a dedicated realtime channel.
    // fetchTodayStats is debounced to coalesce bursty INSERT events.
    useEffect(() => {
        // Guests never write orders to the DB (local-only) and all share the demo
        // address id, so there's nothing to subscribe to — skip the websocket.
        if (!supabase || !addressId || isGuest) return

        let ordersChannel = null
        let statsTimer = null
        let recentTimer = null
        let ordersTimer = null
        let arrivedTimer = null

        const scheduleStatsRefresh = () => {
            clearTimeout(statsTimer)
            statsTimer = setTimeout(() => {
                fetchTodayStats(addressId).then(({ revenue, cups }) => {
                    setRevenue(revenue); setCupsSold(cups)
                })
            }, 2000)
        }

        // Debounce the journal refetch the same way as stats. The bulk RPC returns
        // no id so localOrderIds can't dedup our own echoes — without this, a burst
        // of N orders fires N refetches that each replace the whole list and remount
        // the rows (the "laggy + loạn" under rapid entry). Coalesce to one trailing
        // reconcile; the optimistic rows already show each order instantly. Kept short
        // (300ms) since the counter-staff use case (order-taker outside, counter inside
        // watching Nhật ký) needs the other screen to update within a beat, not seconds.
        const scheduleRecentRefresh = () => {
            clearTimeout(recentTimer)
            recentTimer = setTimeout(() => {
                fetchRecentOrders(addressId, 3).then(recent => {
                    setRecentOrders(recent.map(buildLastOrderFromDB))
                })
            }, 300)
        }

        // Reconcile the /history list (todayOrders) after an edit/soft-delete on
        // ANOTHER device. Low-volume (manual actions, not order bursts) so a plain
        // debounced refetch is enough — no need for the localOrderIds dance.
        const scheduleOrdersRefresh = () => {
            clearTimeout(ordersTimer)
            ordersTimer = setTimeout(() => {
                fetchTodayOrders(addressId)
                    .then(orders => setTodayOrders(prev => {
                        // Rows in the fetch that weren't in our own list yet came from
                        // another device (our own submissions are already there via the
                        // optimistic row) — glow those in /history for a few seconds so
                        // the counter staff notices without staring at the list.
                        const prevIds = new Set(prev.map(o => o.id))
                        const newIds = orders.filter(o => !prevIds.has(o.id)).map(o => o.id)
                        if (newIds.length) {
                            // Merge into the existing glow set (not replace) — two refresh
                            // cycles landing within 3s of each other must not cut the first
                            // batch's glow short.
                            setJustArrivedIds(prev => new Set([...prev, ...newIds]))
                            clearTimeout(arrivedTimer)
                            arrivedTimer = setTimeout(() => setJustArrivedIds(new Set()), 3000)
                        }
                        return mergeFetchedOrders(prev, orders)
                    }))
                    .catch(() => { })
            }, 300)
        }

        const subscribe = () => {
            if (ordersChannel) return
            ordersChannel = supabase
                .channel(`orders-realtime-${addressId}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `address_id=eq.${addressId}` }, (payload) => {
                    scheduleStatsRefresh()

                    // Detect if it's from another device
                    if (!localOrderIds.current.has(payload.new.id)) {
                        scheduleRecentRefresh()
                        scheduleOrdersRefresh()
                    }
                })
                // A discount edit or soft-delete (deleted_at set) lands as an UPDATE.
                // Reconcile revenue, the POS journal header, and the history list so a
                // change on one device shows on the others without a reload.
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `address_id=eq.${addressId}` }, () => {
                    scheduleStatsRefresh()
                    scheduleRecentRefresh()
                    scheduleOrdersRefresh()
                })
                // Fires the instant another device's doSubmit succeeds — skips the
                // postgres_changes WAL-decode hop entirely, so the other screen updates
                // near network-RTT speed instead of waiting on replication. No payload
                // needed; postgres_changes above stays subscribed as the fallback if this
                // broadcast is dropped (tab backgrounded, blip), so a miss just falls back
                // to the same refresh a beat later — never a lost/desynced order.
                .on('broadcast', { event: 'order_added' }, () => {
                    scheduleRecentRefresh()
                    scheduleOrdersRefresh()
                })
                .subscribe()
            ordersChannelRef.current = ordersChannel
        }

        const unsubscribe = () => {
            if (ordersChannel) {
                supabase.removeChannel(ordersChannel)
                ordersChannel = null
                ordersChannelRef.current = null
            }
        }

        let hiddenAt = 0
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                // Gate: only reconnect when >= 2 devices are active on this address —
                // see hasMultiDevice / the heartbeat effect below.
                if (hasMultiDevice) subscribe()
                // Catch-up fetches only after a real absence, so rapid app-switching
                // doesn't pile reads onto a flaky connection (lag-after-foreground).
                if (Date.now() - hiddenAt > 30000) {
                    fetchTodayStats(addressId).then(({ revenue, cups }) => {
                        setRevenue(revenue); setCupsSold(cups)
                    })
                    fetchTodayExpenses(addressId).then(setTodayExpenses).catch(() => { })
                }
            } else {
                hiddenAt = Date.now()
                unsubscribe()
            }
        }

        // Initial state
        if (hasMultiDevice && document.visibilityState === 'visible') subscribe()
        document.addEventListener('visibilitychange', handleVisibility)

        return () => {
            clearTimeout(statsTimer)
            clearTimeout(recentTimer)
            clearTimeout(ordersTimer)
            clearTimeout(arrivedTimer)
            document.removeEventListener('visibilitychange', handleVisibility)
            unsubscribe()
        }
    }, [addressId, isGuest, hasMultiDevice])

    // ---- Heartbeat for active_sessions ----
    useEffect(() => {
        if (!addressId) return
        let cancelled = false

        // Re-check the orders-realtime gate: the device count can change mid-shift
        // (another staff member opens/closes the app), so re-run this on the same
        // interval as the heartbeat below (see its comment for why 30s). Also run
        // once immediately so the channel can open right away on mount (not only
        // after the first tick) if 2+ devices are already active.
        const checkMultiDevice = () => {
            countActiveSessions(addressId).then(count => {
                if (!cancelled) setHasMultiDevice(count >= 2)
            })
        }
        checkMultiDevice()

        // Get profile from auth context via import would create circular dep,
        // so we read userId from localStorage or let AddressContext handle initial upsert
        //
        // checkMultiDevice runs every 30s (cheap read) so the counter-staff device
        // notices a second device joining shift-start within tens of seconds instead
        // of up to 5 minutes — that gap used to mean missed realtime updates for
        // however long the gate stayed closed. upsertSession itself (a write) still
        // only fires every 10th tick (~5 min), unchanged — last_seen only needs to
        // stay inside the 10-minute cutoff in countActiveSessions/fetchActiveSessions.
        let tick = 0
        const interval = setInterval(() => {
            tick += 1
            if (tick % 10 === 0) {
                const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_ADDRESS)
                if (savedId === addressId) {
                    // We need the userId — stored when AddressContext calls upsertSession
                    const userId = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID)
                    if (userId) upsertSession(userId, addressId)
                }
            }
            checkMultiDevice()
        }, 30 * 1000) // every 30s (upsertSession still every ~5min via the tick guard above)

        return () => {
            cancelled = true
            clearInterval(interval)
        }
    }, [addressId])

    const revenueRef = useRef(revenue)
    const totalCostRef = useRef(totalCost)
    const cupsSoldRef = useRef(cupsSold)

    useEffect(() => { revenueRef.current = revenue }, [revenue])
    useEffect(() => { totalCostRef.current = totalCost }, [totalCost])
    useEffect(() => { cupsSoldRef.current = cupsSold }, [cupsSold])

    // ---- Autosave Daemon ----
    // PERF: debounce 5 synchronous localStorage writes that were firing on every
    // keystroke/cart change. localStorage is sync I/O — on slower devices this caused
    // visible jank. 400ms debounce coalesces bursts (typing, rapid add-to-cart) into
    // a single write per quiet period.
    useEffect(() => {
        const t = setTimeout(() => {
            localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart))
            localStorage.setItem(STORAGE_KEYS.REVENUE, revenue.toString())
            localStorage.setItem(STORAGE_KEYS.TOTAL_COST, totalCost.toString())
            localStorage.setItem(STORAGE_KEYS.CUPS, cupsSold.toString())
        }, 400)
        return () => clearTimeout(t)
    }, [cart, revenue, totalCost, cupsSold])

    // Save absolute latest states synchronously on unmount
    useEffect(() => {
        return () => {
            localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cartRef.current))
            localStorage.setItem(STORAGE_KEYS.REVENUE, revenueRef.current.toString())
            localStorage.setItem(STORAGE_KEYS.TOTAL_COST, totalCostRef.current.toString())
            localStorage.setItem(STORAGE_KEYS.CUPS, cupsSoldRef.current.toString())
        }
    }, [])

    // cartRef mirrors cart so commitHeld / handleAddItem can read the latest
    // held item (with extras) synchronously without going stale.
    useEffect(() => { cartRef.current = cart }, [cart])

    // ---- Last order helpers ----
    function buildLastOrderFromDB(order) {
        const map = {}
        for (const i of (order.order_items || [])) {
            const name = i.products?.name || '?'
            const opts = i.options
                ? i.options.split(', ').filter(o => o !== 'Tiền mặt' && o !== 'MoMo').join(', ')
                : ''
            const key = `${name}|${opts}`
            if (!map[key]) map[key] = { name, opts, qty: 0 }
            map[key].qty += i.quantity
        }
        const items = Object.values(map).map(({ qty, name, opts }) =>
            `${qty > 1 ? qty + ' ' : ''}${name}${opts ? ` (${opts})` : ''}`)
        return { id: order.id, total: order.total, createdAt: order.created_at, items }
    }

    function buildLastOrderFromCart(cartItems, total) {
        const map = {}
        for (const i of cartItems) {
            const extras = (i.extras || []).filter(e => e.name !== 'Tiền mặt' && e.name !== 'MoMo')
            const opts = extras.map(e => e.name).join(', ')
            const key = `${i.name}|${opts}`
            if (!map[key]) map[key] = { name: i.name, opts, qty: 0 }
            map[key].qty += i.quantity
        }
        const items = Object.values(map).map(({ qty, name, opts }) =>
            `${qty > 1 ? qty + ' ' : ''}${name}${opts ? ` (${opts})` : ''}`)
        // id = stable unique React key. createdAt is ms-resolution, so two orders
        // committed in the same millisecond would collide as keys → dup-key render bug.
        return { id: crypto.randomUUID(), total, createdAt: new Date().toISOString(), items }
    }

    // ---- Derived values ----
    const total = cart.reduce((sum, item) => {
        const extrasPrice = item.extras.reduce((extraSum, ex) => extraSum + ex.price, 0)
        return sum + (item.basePrice + extrasPrice) * item.quantity
    }, 0)

    const orderCount = cart.reduce((sum, item) => sum + item.quantity, 0)
    const hasOrder = cart.length > 0

    const { discountAmount, finalTotal } = computeDiscount(total, discount)

    // Live draft of the currently-held (not-yet-saved) item — shown as the top
    // line of the header journal so it appears the instant you tap, and extras
    // overwrite it in place (stable 'draft' key in Header → no remount/flash).
    const draftOrder = useMemo(() => cart.length ? { ...buildLastOrderFromCart(cart, total), cartItemId: cart[cart.length - 1].cartItemId } : null, [cart, total])

    // Cart composition / total changed → clear any applied discount so it must be re-entered.
    const clearDiscount = () => setDiscount(d => ({ ...d, value: 0 }))

    // ---- Handlers ----

    // ponytail: fire-and-forget single-item submit, no isSubmitting gate
    function doSubmit(cartItems) {
        if (!cartItems || cartItems.length === 0) return

        const costPerItem = {}
        const cartCost = cartItems.reduce((sum, item) => {
            const c = calculateProductCost(item.productId, item.extras || [], recipes, extraIngredients, ingredientCosts)
            costPerItem[item.cartItemId] = c
            return sum + c * item.quantity
        }, 0)
        const itemTotal = cartItems.reduce((sum, item) => {
            const extrasPrice = item.extras.reduce((s, e) => s + e.price, 0)
            return sum + (item.basePrice + extrasPrice) * item.quantity
        }, 0)
        const countableQty = cartItems.reduce((sum, item) => {
            const prod = products?.find(p => p.id === item.productId)
            return prod?.count_as_cup === false ? sum : sum + item.quantity
        }, 0)

        // Optimistic UI
        setRevenue(prev => prev + itemTotal)
        setTotalCost(prev => prev + cartCost)
        setCupsSold(prev => prev + countableQty)
        // The header "Nhật ký" card shows the last 3 orders (newest first, sliding
        // in) — that's the confirmation. No success toast (it conflicts with the
        // card + lags a tap). Keep the added row's identity to undo it on failure.
        const addedRow = buildLastOrderFromCart(cartItems, itemTotal)
        setRecentOrders(prev => [addedRow, ...prev].slice(0, 3))
        setEnterKey(addedRow.createdAt)

        if (navigator.onLine && supabase) {
            // id is generated here, client-side, and sent straight to the RPC as the
            // real orders.id — the optimistic row and its DB row share one identity
            // from the start, so merging a fetch just needs a Set lookup (see
            // mergeFetchedOrders), no matching by total/time/items/staff.
            const orderId = crypto.randomUUID()
            localOrderIds.current.add(orderId)

            // Optimistic /history row (raw fetchTodayOrders shape) so a just-submitted
            // order shows there instantly — e.g. to delete a mis-entry. _optimistic lets
            // handleLoadHistory keep it until a fetch confirms it (no extra query, no wait).
            const optimisticOrder = {
                _optimistic: true,
                id: orderId,
                total: itemTotal,
                discount_amount: 0,
                total_cost: Math.round(cartCost),
                created_at: addedRow.createdAt,
                staff_name: profile?.name || null,
                deleted_at: null,
                deleted_by: null,
                payment_method: null,
                order_items: cartItems.map(item => ({
                    quantity: item.quantity,
                    options: item.extras?.length ? item.extras.map(e => e.name).join(', ') : null,
                    product_id: item.productId,
                    unit_cost: Math.round(costPerItem[item.cartItemId] || 0),
                    extra_ids: item.extras?.map(e => e.id).filter(Boolean) || [],
                    products: { name: item.name },
                })),
            }
            setTodayOrders(prev => [optimisticOrder, ...prev])
            submitOrder(cartItems, itemTotal, null, addressId, cartCost, costPerItem, profile?.name, 0, orderId)
                .then(() => {
                    // Nudge any other device on this address to refetch now instead of
                    // waiting on postgres_changes' WAL-decode hop — see the channel's
                    // 'broadcast' listener above for the fallback if this is dropped.
                    ordersChannelRef.current?.send({ type: 'broadcast', event: 'order_added', payload: {} })
                })
                .catch(err => {
                    if (!navigator.onLine || /fetch|network|NetworkError/i.test(err?.message || '')) {
                        // Reuse orderId already sent to the RPC above — if the server actually
                        // committed it before the response was lost, the retry is a no-op
                        // (ON CONFLICT) instead of creating a duplicate order.
                        addPendingOrder(
                            cartItems.map(item => ({ ...item, unitCost: costPerItem[item.cartItemId] || 0, extraIds: item.extras.map(e => e.id).filter(Boolean) })),
                            itemTotal, null, addressId, cartCost, profile?.name, 0, orderId
                        )
                        setTodayOrders(prev => prev.filter(o => o !== optimisticOrder)) // offline pending list shows it instead
                        showToast('Lỗi mạng – lưu offline', 'warning')
                    } else {
                        setRevenue(prev => prev - itemTotal)
                        setTotalCost(prev => Math.max(0, prev - cartCost))
                        setCupsSold(prev => Math.max(0, prev - countableQty))
                        setRecentOrders(prev => prev.filter(o => o !== addedRow)) // genuine failure → don't leave a phantom order in the journal
                        setTodayOrders(prev => prev.filter(o => o !== optimisticOrder))
                        showError(err, 'Ghi đơn')
                    }
                })
        } else {
            addPendingOrder(
                cartItems.map(item => ({ ...item, unitCost: costPerItem[item.cartItemId] || 0, extraIds: item.extras.map(e => e.id) })),
                itemTotal, null, addressId, cartCost, profile?.name, 0
            )
            showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
        }
    }

    // 1-tap model: each tap submits the previously-held item, then holds the
    // new one. Extras toggle on the held item until the next tap.
    function handleAddItem(product) {
        if (cartRef.current.length > 0) doSubmit(cartRef.current)

        const cartItemId = crypto.randomUUID()
        const stickyExtras = (productExtras[product.id] || []).filter(e => e.is_sticky && enabledStickyExtraIds.includes(e.id))
        const newItem = { cartItemId, productId: product.id, name: product.name, basePrice: product.price, quantity: 1, extras: [...stickyExtras] }
        // Update cartRef SYNCHRONOUSLY (not just via the [cart] effect) so a very
        // fast next tap reads this held item and submits it — otherwise the effect
        // lags one frame and the item can be overwritten unsubmitted (lost order).
        cartRef.current = [newItem]
        setCart([newItem])
        setActiveCartItemId(cartItemId)
        clearDiscount()
    }

    // Cancel the currently-held item without submitting (undo a mis-tap).
    function cancelHeld() {
        cartRef.current = []
        setCart([])
        setActiveCartItemId(null)
        localStorage.setItem(STORAGE_KEYS.CART, '[]')
    }

    // Submit the held item and clear — used by the ✓ button (confirm the LAST order
    // without holding a new one) and by the unmount flush when leaving the POS
    // screen. Without it the last held order would never reach the DB.
    function commitHeld() {
        if (cartRef.current.length === 0) return
        doSubmit(cartRef.current)
        cartRef.current = [] // sync guard: a fast double-press must not re-submit
        setCart([])
        setActiveCartItemId(null)
        localStorage.setItem(STORAGE_KEYS.CART, '[]')
    }

    // Extras read/write cartRef.current synchronously (not setCart's prev) so the
    // held item's extras are never stale when the next tap submits it.
    function handleToggleStickyExtra(extra) {
        const isEnabledNow = enabledStickyExtraIds.includes(extra.id)
        setEnabledStickyExtraIds(isEnabledNow ? enabledStickyExtraIds.filter(id => id !== extra.id) : [...enabledStickyExtraIds, extra.id])

        const prev = cartRef.current
        if (prev.length > 0) {
            let idx = prev.findIndex(item => item.cartItemId === activeCartItemId)
            if (idx === -1) idx = prev.length - 1
            const target = prev[idx]
            let newExtras = [...target.extras]
            if (!isEnabledNow) {
                if (!newExtras.some(e => e.id === extra.id)) newExtras.push(extra)
            } else {
                newExtras = newExtras.filter(e => e.id !== extra.id)
            }
            const next = [...prev]
            next[idx] = { ...target, extras: newExtras }
            cartRef.current = next
            setCart(next)
            clearDiscount()
        }
    }

    function handleToggleExtra(extra) {
        const prev = cartRef.current
        if (prev.length === 0) return
        let idx = prev.findIndex(item => item.cartItemId === activeCartItemId)
        if (idx === -1) idx = prev.length - 1
        const target = prev[idx]
        const hasExtra = target.extras.some(e => e.id === extra.id)
        const newExtras = hasExtra ? target.extras.filter(e => e.id !== extra.id) : [...target.extras, extra]
        const next = [...prev]
        next[idx] = { ...target, extras: newExtras }
        cartRef.current = next
        setCart(next)
        clearDiscount()
    }

    async function handleLoadHistory() {
        if (!addressId) return
        // Freshness guard: dedup truly-simultaneous re-invocations (React re-render
        // churn), not a substitute for a real refetch — realtime INSERT now also
        // wires into scheduleOrdersRefresh, so this only needs to be a few seconds.
        const last = historyFetchedRef.current
        if (last.addressId === addressId && Date.now() - last.at < 4000) return
        setIsLoadingHistory(true)
        try {
            const [orders, expenses] = await Promise.all([
                fetchTodayOrders(addressId),
                fetchTodayExpenses(addressId),
            ])
            historyFetchedRef.current = { addressId, at: Date.now() }
            // Merge, don't clobber: keep optimistic rows the fetch doesn't have yet (their
            // insert is still in flight) so a just-tapped order never vanishes. Once the
            // fetch includes an id, its real row wins and the optimistic copy is dropped —
            // no duplicates, no extra query, no waiting on the insert.
            setTodayOrders(prev => mergeFetchedOrders(prev, orders))
            setTodayExpenses(expenses)
        } catch (err) {
            showError(err, 'Tải lịch sử đơn hàng')
        } finally {
            setIsLoadingHistory(false)
        }
    }

    async function handleDeleteOrder(orderId) {
        try {
            await deleteOrder(orderId, profile?.name)
            setTodayOrders(prev => prev.map(o => o.id === orderId ? { ...o, deleted_at: new Date().toISOString(), deleted_by: profile?.name } : o))
            if (addressId) {
                const { revenue: rev, cups } = await fetchTodayStats(addressId)
                setRevenue(rev)
                setCupsSold(cups)
                // Keep the POS journal header in sync — without this a delete here
                // leaves the removed order showing on /pos until the next reload.
                fetchRecentOrders(addressId, 3).then(recent => setRecentOrders(recent.map(buildLastOrderFromDB)))
                invalidateDailyContext(addressId)
            }
            showToast('Đã xóa đơn hàng', 'success')
        } catch (err) {
            showError(err, 'Xóa đơn hàng')
        }
    }

    // Re-apply / edit a discount on an existing order. `total` is the new charged
    // amount (already computed from subtotal − discount by the caller). Updates the
    // local raw row + recomputes stats + the POS journal header (total changed).
    async function handleUpdateOrderDiscount(orderId, total, discountAmount) {
        try {
            await updateOrderDiscount(orderId, total, discountAmount)
            setTodayOrders(prev => prev.map(o => o.id === orderId ? { ...o, total, discount_amount: discountAmount } : o))
            if (addressId) {
                const { revenue: rev, cups } = await fetchTodayStats(addressId)
                setRevenue(rev)
                setCupsSold(cups)
                fetchRecentOrders(addressId, 3).then(recent => setRecentOrders(recent.map(buildLastOrderFromDB)))
                invalidateDailyContext(addressId)
            }
            showToast('Đã cập nhật giảm giá', 'success')
        } catch (err) {
            showError(err, 'Cập nhật giảm giá')
        }
    }

    async function handleAddExpense(name, amount, isRefill = false, paymentMethod = 'cash', metadata = {}, isFixed = false, categoryId = null, createdAt = null) {
        if (!addressId) return
        try {
            const expense = await insertExpense(name, amount, addressId, isFixed, profile?.name, isRefill, paymentMethod, metadata, categoryId, createdAt)
            // Only fold into today's local list when it actually belongs to today —
            // a backdated expense (createdAt in the past) shows up on its own day's
            // range view, not today's. invalidateDailyContext below refreshes both.
            const isToday = !createdAt || dateStringVN(new Date(createdAt)) === dateStringVN(new Date())
            if (isToday) {
                setTodayExpenses(prev => [expense, ...prev])
                if (!isFixed) setTotalCost(prev => prev + amount)
            }
            invalidateDailyContext(addressId)
            showToast(isFixed ? 'Đã ghi nhận thực chi cố định' : isRefill ? 'Đã thêm khoản mua nguyên vật liệu' : 'Đã thêm chi phí', 'success')
            return expense
        } catch (err) {
            showError(err, isFixed ? 'Ghi nhận thực chi cố định' : isRefill ? 'Thêm mua nguyên vật liệu' : 'Thêm chi phí')
            throw err
        }
    }

    async function handleUpdateExpense(expenseId, updates) {
        try {
            const updated = await updateExpense(expenseId, updates)
            // Patch today's local list if the row belongs to today's shift; range
            // views refetch via invalidateReportCache happening inside updateExpense.
            setTodayExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, ...updates } : e))
            invalidateDailyContext(addressId)
            return updated
        } catch (err) {
            showError(err, 'Cập nhật chi phí')
            throw err
        }
    }

    async function handleDeleteExpense(expenseId, amount) {
        try {
            await deleteExpense(expenseId)
            const wasFixed = todayExpenses.find(e => e.id === expenseId)?.is_fixed
            setTodayExpenses(prev => prev.filter(e => e.id !== expenseId))
            if (!wasFixed) setTotalCost(prev => Math.max(0, prev - amount))
            invalidateDailyContext(addressId)
            showToast('Đã xóa chi phí', 'success')
        } catch (err) {
            showError(err, 'Xóa chi phí')
        }
    }

    // Re-fetch today expenses (e.g. after restock RPC bypasses handleAddExpense)
    async function refreshTodayExpenses() {
        if (!addressId) return
        try {
            const expenses = await fetchTodayExpenses(addressId)
            setTodayExpenses(expenses)
        } catch (err) {
            showError(err, 'Tải lại chi phí')
        }
    }

    const userRole = profile?.role || 'staff'

    // ---- Memoized slices ----
    // Each useMemo's deps list only the state this slice exposes. A change to,
    // say, todayOrders won't recompute cartValue → useCart consumers don't
    // re-render. (Function identities are stable across renders only when their
    // deps don't change; the original code already recreated them every render,
    // so this is no worse and slices keep change frequencies separated.)
    const cartValue = useMemo(() => ({
        cart, activeCartItemId,
        handleAddItem, cancelHeld, handleToggleExtra, handleToggleStickyExtra, commitHeld,
        enabledStickyExtraIds, setEnabledStickyExtraIds,
        total, orderCount, hasOrder,
        discount, setDiscount, discountAmount, finalTotal,
        recentOrders, draftOrder, enterKey,
        toast, showToast,
        // deliberately partial deps, see comment above
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [cart, activeCartItemId, enabledStickyExtraIds, total, orderCount, hasOrder, discount, discountAmount, finalTotal, recentOrders, draftOrder, enterKey, toast, showToast])

    const statsValue = useMemo(() => ({
        revenue, totalCost, cupsSold, isOnline,
        retrySync,
    }), [revenue, totalCost, cupsSold, isOnline, retrySync])

    const historyValue = useMemo(() => ({
        todayOrders, todayExpenses, isLoadingHistory, justArrivedIds,
        handleLoadHistory, handleDeleteOrder, handleUpdateOrderDiscount, handleAddExpense, handleUpdateExpense, handleDeleteExpense, refreshTodayExpenses,
        userRole,
        // deliberately partial deps, see comment above
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [todayOrders, todayExpenses, isLoadingHistory, justArrivedIds, userRole])

    return (
        <CartContext.Provider value={cartValue}>
            <StatsContext.Provider value={statsValue}>
                <HistoryContext.Provider value={historyValue}>
                    <Outlet />
                </HistoryContext.Provider>
            </StatsContext.Provider>
        </CartContext.Provider>
    )
}
