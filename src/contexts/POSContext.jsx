import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchTodayStats, fetchInventory, submitOrder, fetchTodayOrders, deleteOrder, fetchTodayExpenses, insertExpense, updateExpense, deleteExpense, fetchLatestOrder, invalidateDailyContext } from '../services/orderService'
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
    const { profile } = useAuth()
    const addressId = selectedAddress?.id

    const localOrderIds = useRef(new Set())

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
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const { toast, showToast, showError } = useToast()

    // ---- History State ----
    const [todayOrders, setTodayOrders] = useState([])
    const [todayExpenses, setTodayExpenses] = useState([])
    const [isLoadingHistory, setIsLoadingHistory] = useState(false)
    const [lastOrder, setLastOrder] = useState(null)

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
                const [{ revenue: rev, cups }, inv, latest] = await Promise.all([
                    fetchTodayStats(addressId),
                    fetchInventory(),
                    fetchLatestOrder(addressId)
                ])
                if (latest) setLastOrder(buildLastOrderFromDB(latest))
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
        if (!supabase || !addressId) return

        let ordersChannel = null
        let statsTimer = null

        const scheduleStatsRefresh = () => {
            clearTimeout(statsTimer)
            statsTimer = setTimeout(() => {
                fetchTodayStats(addressId).then(({ revenue, cups }) => {
                    setRevenue(revenue); setCupsSold(cups)
                })
            }, 2000)
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
                            fetchLatestOrder(addressId).then(latest => {
                                if (latest) setLastOrder(buildLastOrderFromDB(latest))
                            })
                        }
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

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                subscribe()
                // Catch up on anything missed while tab was hidden
                fetchTodayStats(addressId).then(({ revenue, cups }) => {
                    setRevenue(revenue); setCupsSold(cups)
                })
                fetchTodayExpenses(addressId).then(setTodayExpenses).catch(() => { })
            } else {
                unsubscribe()
            }
        }

        // Initial state
        if (document.visibilityState === 'visible') subscribe()
        document.addEventListener('visibilitychange', handleVisibility)

        return () => {
            clearTimeout(statsTimer)
            document.removeEventListener('visibilitychange', handleVisibility)
            unsubscribe()
        }
    }, [addressId])

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
            `${qty} ${name}${opts ? ` (${opts})` : ''}`)
        return { total: order.total, createdAt: order.created_at, items }
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
            `${qty} ${name}${opts ? ` (${opts})` : ''}`)
        return { total, createdAt: new Date().toISOString(), items }
    }

    // ---- Derived values ----
    const total = cart.reduce((sum, item) => {
        const extrasPrice = item.extras.reduce((extraSum, ex) => extraSum + ex.price, 0)
        return sum + (item.basePrice + extrasPrice) * item.quantity
    }, 0)

    const orderCount = cart.reduce((sum, item) => sum + item.quantity, 0)
    const hasOrder = cart.length > 0

    const { discountAmount, finalTotal } = computeDiscount(total, discount)

    // Cart composition / total changed → clear any applied discount so it must be re-entered.
    const clearDiscount = () => setDiscount(d => ({ ...d, value: 0 }))

    // ---- Handlers ----
    function handleAddItem(product) {
        const cartItemId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2, 9)
        const stickyExtras = (productExtras[product.id] || []).filter(e => e.is_sticky && enabledStickyExtraIds.includes(e.id))
        setCart(prev => [...prev, {
            cartItemId,
            productId: product.id,
            name: product.name,
            basePrice: product.price,
            quantity: 1,
            extras: [...stickyExtras]
        }])
        setActiveCartItemId(cartItemId)
        clearDiscount()
    }

    function handleRemoveCartItem(cartItemId) {
        setCart(prev => prev.filter(item => item.cartItemId !== cartItemId))
        clearDiscount()
    }

    function handleToggleStickyExtra(extra) {
        setEnabledStickyExtraIds(prev => {
            const isEnabledNow = prev.includes(extra.id)
            const nextState = isEnabledNow ? prev.filter(id => id !== extra.id) : [...prev, extra.id]

            // Sync current active item to match the new global state
            setCart(prevCart => {
                if (prevCart.length === 0) return prevCart
                let targetIndex = prevCart.findIndex(item => item.cartItemId === activeCartItemId)
                if (targetIndex === -1) targetIndex = prevCart.length - 1

                const next = [...prevCart]
                const targetItem = next[targetIndex]

                let newExtras = [...targetItem.extras]
                if (!isEnabledNow) {
                    if (!newExtras.some(e => e.id === extra.id)) newExtras.push(extra)
                } else {
                    newExtras = newExtras.filter(e => e.id !== extra.id)
                }

                next[targetIndex] = { ...targetItem, extras: newExtras }
                return next
            })

            return nextState
        })
        if (cart.length) clearDiscount()
    }

    function handleToggleExtra(extra) {
        setCart(prev => {
            if (prev.length === 0) return prev
            let targetIndex = prev.findIndex(item => item.cartItemId === activeCartItemId)
            if (targetIndex === -1) targetIndex = prev.length - 1

            const next = [...prev]
            const targetItem = next[targetIndex]
            const hasExtra = targetItem.extras.some(e => e.id === extra.id)
            const newExtras = hasExtra ? targetItem.extras.filter(e => e.id !== extra.id) : [...targetItem.extras, extra]

            next[targetIndex] = { ...targetItem, extras: newExtras }
            return next
        })
        if (cart.length) clearDiscount()
    }

    async function handleConfirm() {
        if (cart.length === 0 || isSubmitting) return
        setIsSubmitting(true)

        // Build cost snapshot: per-item and total
        const costPerItem = {}
        const cartCost = cart.reduce((sum, item) => {
            const itemCost = calculateProductCost(item.productId, item.extras || [], recipes, extraIngredients, ingredientCosts)
            costPerItem[item.cartItemId] = itemCost
            return sum + (itemCost * item.quantity)
        }, 0)

        // Optimistic: update UI immediately
        const savedCart = [...cart]
        const savedTotal = finalTotal
        const savedDiscount = discountAmount
        const savedOrderCount = orderCount
        const countableQty = cart.reduce((sum, item) => {
            const prod = products?.find(p => p.id === item.productId)
            if (prod?.count_as_cup === false) return sum
            return sum + item.quantity
        }, 0)
        setRevenue(prev => prev + savedTotal)
        setTotalCost(prev => prev + cartCost)
        setCupsSold(prev => prev + countableQty)
        setLastOrder(buildLastOrderFromCart(savedCart, savedTotal))
        setCart([])
        setActiveCartItemId(null)
        clearDiscount()
        showToast('Tạo thành công', 'success')

        // Submit in background (with COGS snapshot)
        if (navigator.onLine && supabase) {
            submitOrder(savedCart, savedTotal, null, addressId, cartCost, costPerItem, profile?.name, savedDiscount).then(res => {
                localOrderIds.current.add(res.id)
            }).catch((err) => {
                // Only fallback to offline for genuine network errors
                if (!navigator.onLine || err?.message?.includes('fetch') || err?.message?.includes('network') || err?.message?.includes('NetworkError')) {
                    const enrichedCart = savedCart.map(item => ({
                        ...item,
                        unitCost: costPerItem[item.cartItemId] || 0,
                        extraIds: (item.extras || []).map(e => e.id).filter(Boolean)
                    }))
                    addPendingOrder(enrichedCart, savedTotal, null, addressId, cartCost, profile?.name, savedDiscount)
                    showToast('Lỗi mạng – đã lưu offline', 'warning')
                } else {
                    showError(err, 'Tạo đơn hàng')
                }
            })
        } else {
            const enrichedCart = savedCart.map(item => ({
                ...item,
                unitCost: costPerItem[item.cartItemId] || 0,
                extraIds: (item.extras || []).map(e => e.id)
            }))
            addPendingOrder(enrichedCart, savedTotal, null, addressId, cartCost, profile?.name, savedDiscount)
            showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
        }
        setIsSubmitting(false)
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
                invalidateDailyContext(addressId)
            }
            showToast('Đã xóa đơn hàng', 'success')
        } catch (err) {
            showError(err, 'Xóa đơn hàng')
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
        cart, activeCartItemId, setActiveCartItemId,
        handleAddItem, handleRemoveCartItem, handleToggleExtra, handleToggleStickyExtra, handleConfirm,
        enabledStickyExtraIds, setEnabledStickyExtraIds,
        total, orderCount, hasOrder, isSubmitting,
        discount, setDiscount, discountAmount, finalTotal,
        lastOrder,
        toast, showToast,
    }), [cart, activeCartItemId, enabledStickyExtraIds, total, orderCount, hasOrder, isSubmitting, discount, discountAmount, finalTotal, lastOrder, toast, showToast])

    const statsValue = useMemo(() => ({
        revenue, totalCost, cupsSold, inventory, isOnline,
        retrySync,
    }), [revenue, totalCost, cupsSold, inventory, isOnline, retrySync])

    const historyValue = useMemo(() => ({
        todayOrders, todayExpenses, isLoadingHistory,
        handleLoadHistory, handleDeleteOrder, handleAddExpense, handleUpdateExpense, handleDeleteExpense, refreshTodayExpenses,
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
