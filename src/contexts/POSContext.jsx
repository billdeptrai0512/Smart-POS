import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchTodayStats, fetchInventory, submitOrder, fetchTodayOrders, deleteOrder, updateOrderDiscount, fetchTodayExpenses, insertExpense, updateExpense, deleteExpense, fetchRecentOrders, invalidateDailyContext } from '../services/orderService'
import { upsertSession } from '../services/authService'
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

const POSContext = createContext(null)

// usePOS returns the merged slice (cart + stats + history + shared) for
// back-compat. Prefer the focused hooks in new code:
//   useCart()    — re-renders only on cart-related changes
//   useStats()   — re-renders only on running totals
//   useHistory() — re-renders only on orders/expenses/fixed costs
export function usePOS() {
    const ctx = useContext(POSContext)
    if (!ctx) throw new Error('usePOS must be used within POSProvider')
    return ctx
}

export function POSProvider() {
    const { products, recipes, ingredientCosts, extraIngredients, productExtras } = useProducts()
    const { selectedAddress } = useAddress()
    const { profile, isGuest } = useAuth()
    const addressId = selectedAddress?.id

    const localOrderIds = useRef(new Set())
    const cartRef = useRef([])

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
    const [inventory, setInventory] = useState(() => loadLocalJSON(STORAGE_KEYS.INVENTORY, {}))
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const { toast, showToast, showError } = useToast()

    // ---- History State ----
    const [todayOrders, setTodayOrders] = useState([])
    const [todayExpenses, setTodayExpenses] = useState([])
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)
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
        fetchInventory().then(setInventory)
        showToast('Đã đồng bộ đơn hàng offline!', 'success')
    }, [addressId])

    const { getPendingCount, retrySync } = useOfflineSync(handleSyncComplete)

    // ---- Load data when address changes ----
    useEffect(() => {
        if (!addressId) return

        async function load() {
            try {
                const [{ revenue: rev, cups }, inv, recent] = await Promise.all([
                    fetchTodayStats(addressId),
                    fetchInventory(),
                    fetchRecentOrders(addressId, 3)
                ])
                setRecentOrders(recent.map(buildLastOrderFromDB))
                if (supabase) {
                    setRevenue(rev)
                    setInventory(inv)
                    setCupsSold(cups)
                } else {
                    setInventory(prev => Object.keys(prev).length ? prev : inv)
                }
            } catch (error) {
                showError(error, 'Tải dữ liệu hôm nay')
            }
        }
        load()
    }, [addressId])

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
    }, [addressId])

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
        // reconcile; the optimistic rows already show each order instantly.
        const scheduleRecentRefresh = () => {
            clearTimeout(recentTimer)
            recentTimer = setTimeout(() => {
                fetchRecentOrders(addressId, 3).then(recent => {
                    setRecentOrders(recent.map(buildLastOrderFromDB))
                })
            }, 1500)
        }

        // Reconcile the /history list (todayOrders) after an edit/soft-delete on
        // ANOTHER device. Low-volume (manual actions, not order bursts) so a plain
        // debounced refetch is enough — no need for the localOrderIds dance.
        const scheduleOrdersRefresh = () => {
            clearTimeout(ordersTimer)
            ordersTimer = setTimeout(() => {
                fetchTodayOrders(addressId).then(setTodayOrders).catch(() => { })
            }, 1500)
        }

        const subscribe = () => {
            if (ordersChannel) return
            ordersChannel = supabase
                .channel(`orders-realtime-${addressId}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
                    if (payload.new?.address_id === addressId) {
                        scheduleStatsRefresh()

                        // Detect if it's from another device
                        if (!localOrderIds.current.has(payload.new.id)) {
                            scheduleRecentRefresh()
                        }
                    }
                })
                // A discount edit or soft-delete (deleted_at set) lands as an UPDATE.
                // Reconcile revenue, the POS journal header, and the history list so a
                // change on one device shows on the others without a reload.
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
                    if (payload.new?.address_id === addressId) {
                        scheduleStatsRefresh()
                        scheduleRecentRefresh()
                        scheduleOrdersRefresh()
                    }
                })
                .subscribe()
        }

        const unsubscribe = () => {
            if (ordersChannel) {
                supabase.removeChannel(ordersChannel)
                ordersChannel = null
            }
        }

        let hiddenAt = 0
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                subscribe() // always reconnect the socket — it's cheap and required
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
        if (document.visibilityState === 'visible') subscribe()
        document.addEventListener('visibilitychange', handleVisibility)

        return () => {
            clearTimeout(statsTimer)
            clearTimeout(recentTimer)
            clearTimeout(ordersTimer)
            document.removeEventListener('visibilitychange', handleVisibility)
            unsubscribe()
        }
    }, [addressId, isGuest])

    // ---- Heartbeat for active_sessions ----
    useEffect(() => {
        if (!addressId) return
        // Get profile from auth context via import would create circular dep,
        // so we read userId from localStorage or let AddressContext handle initial upsert
        const interval = setInterval(() => {
            // Re-upsert session to keep last_seen fresh
            const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_ADDRESS)
            if (savedId === addressId) {
                // We need the userId — stored when AddressContext calls upsertSession
                const userId = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID)
                if (userId) upsertSession(userId, addressId)
            }
        }, 5 * 60 * 1000) // every 5 minutes

        return () => clearInterval(interval)
    }, [addressId])

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
            localStorage.setItem(STORAGE_KEYS.INVENTORY, JSON.stringify(inventory))
        }, 400)
        return () => clearTimeout(t)
    }, [cart, revenue, totalCost, cupsSold, inventory])

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
            submitOrder(cartItems, itemTotal, null, addressId, cartCost, costPerItem, profile?.name, 0)
                .then(res => { if (res?.id) localOrderIds.current.add(res.id) })
                .catch(err => {
                    if (!navigator.onLine || /fetch|network|NetworkError/i.test(err?.message || '')) {
                        addPendingOrder(
                            cartItems.map(item => ({ ...item, unitCost: costPerItem[item.cartItemId] || 0, extraIds: item.extras.map(e => e.id).filter(Boolean) })),
                            itemTotal, null, addressId, cartCost, profile?.name, 0
                        )
                        showToast('Lỗi mạng – lưu offline', 'warning')
                    } else {
                        setRevenue(prev => prev - itemTotal)
                        setTotalCost(prev => Math.max(0, prev - cartCost))
                        setCupsSold(prev => Math.max(0, prev - countableQty))
                        setRecentOrders(prev => prev.filter(o => o !== addedRow)) // genuine failure → don't leave a phantom order in the journal
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
        setIsLoadingHistory(true)
        try {
            const [orders, expenses] = await Promise.all([
                fetchTodayOrders(addressId),
                fetchTodayExpenses(addressId),
            ])
            setTodayOrders(orders)
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
    }), [cart, activeCartItemId, enabledStickyExtraIds, total, orderCount, hasOrder, discount, discountAmount, finalTotal, recentOrders, draftOrder, enterKey, toast, showToast])

    const statsValue = useMemo(() => ({
        revenue, totalCost, cupsSold, inventory, isOnline,
        retrySync,
    }), [revenue, totalCost, cupsSold, inventory, isOnline, retrySync])

    const historyValue = useMemo(() => ({
        todayOrders, todayExpenses, isLoadingHistory,
        handleLoadHistory, handleDeleteOrder, handleUpdateOrderDiscount, handleAddExpense, handleUpdateExpense, handleDeleteExpense, refreshTodayExpenses,
        userRole,
    }), [todayOrders, todayExpenses, isLoadingHistory, userRole])

    // Merged value for usePOS() back-compat. New code should use the focused hooks.
    const mergedValue = useMemo(() => ({
        ...cartValue, ...statsValue, ...historyValue,
    }), [cartValue, statsValue, historyValue])

    return (
        <CartContext.Provider value={cartValue}>
            <StatsContext.Provider value={statsValue}>
                <HistoryContext.Provider value={historyValue}>
                    <POSContext.Provider value={mergedValue}>
                        <Outlet />
                    </POSContext.Provider>
                </HistoryContext.Provider>
            </StatsContext.Provider>
        </CartContext.Provider>
    )
}
