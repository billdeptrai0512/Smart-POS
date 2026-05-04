import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchTodayStats, fetchInventory, submitOrder, fetchTodayOrders, deleteOrder, fetchTodayExpenses, insertExpense, deleteExpense, fetchFixedCosts, insertFixedCost, updateFixedCost, deleteFixedCost, fetchLatestOrder } from '../services/orderService'
import { upsertSession } from '../services/authService'
import { useOfflineSync, addPendingOrder } from '../hooks/useOfflineSync'
import { calculateProductCost } from '../utils'
import { useProducts } from './ProductContext'
import { useAddress } from './AddressContext'
import { useAuth } from './AuthContext'
import { Outlet } from 'react-router-dom'
import { useToast } from '../hooks/useToast'

const POSContext = createContext(null)

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

    const [cart, setCart] = useState(() => loadLocalJSON('pos_cart', []))
    const [activeCartItemId, setActiveCartItemId] = useState(null)
    const [enabledStickyExtraIds, setEnabledStickyExtraIds] = useState([])
    const [revenue, setRevenue] = useState(() => Number(localStorage.getItem('pos_revenue')) || 0)
    const [totalCost, setTotalCost] = useState(() => Number(localStorage.getItem('pos_total_cost')) || 0)
    const [cupsSold, setCupsSold] = useState(() => Number(localStorage.getItem('pos_cups')) || 0)
    const [inventory, setInventory] = useState(() => loadLocalJSON('pos_inventory', {}))
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const { toast, showToast, showError } = useToast()

    // ---- History State ----
    const [todayOrders, setTodayOrders] = useState([])
    const [todayExpenses, setTodayExpenses] = useState([])
    const [fixedCosts, setFixedCosts] = useState([])
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
            const storedDate = localStorage.getItem('pos_current_date')
            const todayStr = new Date().toDateString()
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
                localStorage.setItem('pos_current_date', todayStr)
            } else if (!storedDate) {
                localStorage.setItem('pos_current_date', todayStr)
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
            const savedId = localStorage.getItem('pos_selected_address')
            if (savedId === addressId) {
                // We need the userId — stored when AddressContext calls upsertSession
                const userId = localStorage.getItem('pos_active_user_id')
                if (userId) upsertSession(userId, addressId)
            }
        }, 5 * 60 * 1000) // every 5 minutes

        return () => clearInterval(interval)
    }, [addressId])

    // ---- Autosave Daemon ----
    useEffect(() => {
        localStorage.setItem('pos_cart', JSON.stringify(cart))
        localStorage.setItem('pos_revenue', revenue.toString())
        localStorage.setItem('pos_total_cost', totalCost.toString())
        localStorage.setItem('pos_cups', cupsSold.toString())
        localStorage.setItem('pos_inventory', JSON.stringify(inventory))
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
    }

    function handleRemoveCartItem(cartItemId) {
        setCart(prev => prev.filter(item => item.cartItemId !== cartItemId))
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
        const savedTotal = total
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
        showToast('Tạo thành công', 'success')

        // Submit in background (with COGS snapshot)
        if (navigator.onLine && supabase) {
            submitOrder(savedCart, savedTotal, null, addressId, cartCost, costPerItem, profile?.name).then(res => {
                localOrderIds.current.add(res.id)
            }).catch((err) => {
                // Only fallback to offline for genuine network errors
                if (!navigator.onLine || err?.message?.includes('fetch') || err?.message?.includes('network') || err?.message?.includes('NetworkError')) {
                    const enrichedCart = savedCart.map(item => ({
                        ...item,
                        unitCost: costPerItem[item.cartItemId] || 0,
                        extraIds: (item.extras || []).map(e => e.id).filter(Boolean)
                    }))
                    addPendingOrder(enrichedCart, savedTotal, null, addressId, cartCost, profile?.name)
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
            addPendingOrder(enrichedCart, savedTotal, null, addressId, cartCost, profile?.name)
            showToast(`Lưu offline (${getPendingCount()} đơn chờ)`, 'warning')
        }
        setIsSubmitting(false)
    }

    async function handleLoadHistory() {
        if (!addressId) return
        setIsLoadingHistory(true)
        try {
            const [orders, expenses, fixed] = await Promise.all([
                fetchTodayOrders(addressId),
                fetchTodayExpenses(addressId),
                fetchFixedCosts(addressId)
            ])
            setTodayOrders(orders)
            setTodayExpenses(expenses)
            setFixedCosts(fixed)
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
            }
            showToast('Đã xóa đơn hàng', 'success')
        } catch (err) {
            showError(err, 'Xóa đơn hàng')
        }
    }

    async function handleAddExpense(name, amount, isRefill = false, paymentMethod = 'cash') {
        if (!addressId) return
        try {
            const expense = await insertExpense(name, amount, addressId, false, profile?.name, isRefill, paymentMethod)
            setTodayExpenses(prev => [expense, ...prev])
            setTotalCost(prev => prev + amount)
            showToast(isRefill ? 'Đã thêm khoản mua nguyên vật liệu' : 'Đã thêm chi phí', 'success')
            return expense
        } catch (err) {
            showError(err, isRefill ? 'Thêm mua nguyên vật liệu' : 'Thêm chi phí')
            throw err
        }
    }

    async function handleDeleteExpense(expenseId, amount) {
        try {
            await deleteExpense(expenseId)
            setTodayExpenses(prev => prev.filter(e => e.id !== expenseId))
            setTotalCost(prev => Math.max(0, prev - amount))
            showToast('Đã xóa chi phí', 'success')
        } catch (err) {
            showError(err, 'Xóa chi phí')
        }
    }

    // ---- Fixed Costs Handlers ----
    async function handleLoadFixedCosts() {
        if (!addressId) return
        try {
            const fixed = await fetchFixedCosts(addressId)
            setFixedCosts(fixed)
        } catch (err) {
            showError(err, 'Tải chi phí cố định')
        }
    }

    async function handleAddFixedCost(name, amount) {
        if (!addressId) return
        try {
            const item = await insertFixedCost(name, amount, addressId)
            setFixedCosts(prev => [...prev, item])
            showToast('Đã thêm chi phí cố định', 'success')
            return item
        } catch (err) {
            showError(err, 'Thêm chi phí cố định')
            throw err
        }
    }

    async function handleUpdateFixedCost(id, updates) {
        try {
            const updated = await updateFixedCost(id, updates)
            setFixedCosts(prev => prev.map(fc => fc.id === id ? updated : fc))
            showToast('Đã cập nhật chi phí cố định', 'success')
            return updated
        } catch (err) {
            showError(err, 'Cập nhật chi phí cố định')
            throw err
        }
    }

    async function handleDeleteFixedCost(id) {
        try {
            await deleteFixedCost(id)
            setFixedCosts(prev => prev.filter(fc => fc.id !== id))
            showToast('Đã xóa chi phí cố định', 'success')
        } catch (err) {
            showError(err, 'Xóa chi phí cố định')
        }
    }

    return (
        <POSContext.Provider value={{
            // Cart
            cart, activeCartItemId, setActiveCartItemId,
            handleAddItem, handleRemoveCartItem, handleToggleExtra, handleToggleStickyExtra, handleConfirm,
            enabledStickyExtraIds, setEnabledStickyExtraIds,
            total, orderCount, hasOrder, isSubmitting,
            // Dashboard
            revenue, totalCost, cupsSold, inventory, isOnline,
            // History
            todayOrders, todayExpenses, isLoadingHistory, handleLoadHistory, handleDeleteOrder, handleAddExpense, handleDeleteExpense,
            lastOrder,
            // Fixed Costs
            fixedCosts, handleLoadFixedCosts, handleAddFixedCost, handleUpdateFixedCost, handleDeleteFixedCost,
            // User info
            userRole: profile?.role || 'staff',
            // Offline sync
            retrySync,
            // Toast & Realtime
            toast, showToast
        }}>
            <Outlet />
        </POSContext.Provider>
    )
}
