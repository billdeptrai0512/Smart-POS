import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { supabase } from '../lib/supabaseClient'
import { Outlet } from 'react-router-dom'
import { cacheKey as buildCacheKey } from '../constants/storageKeys'

const ProductContext = createContext(null)

// ponytail: hook co-located with its Provider (standard context pattern) —
// splitting into its own file isn't worth the diff for a fast-refresh (dev-only HMR) nag.
// eslint-disable-next-line react-refresh/only-export-components
export function useProducts() {
    const ctx = useContext(ProductContext)
    if (!ctx) throw new Error('useProducts must be used within ProductProvider')
    return ctx
}

export function ProductProvider() {
    const { profile } = useAuth()
    const activeManagerId = profile?.role === 'manager' ? profile.id : profile?.manager_id
    const { selectedAddress } = useAddress()

    const cacheKey = useCallback((name) => buildCacheKey(selectedAddress?.id || 'default', name), [selectedAddress?.id])

    const readCache = useCallback((name, fallback) => {
        try {
            const cached = localStorage.getItem(cacheKey(name))
            return cached ? JSON.parse(cached) : fallback
        } catch { return fallback }
    }, [cacheKey])

    const [products, setProducts] = useState(() => readCache('products', []))
    const [recipes, setRecipes] = useState(() => readCache('recipes', []))
    const [ingredientCosts, setIngredientCosts] = useState(() => readCache('costs', {}))
    const [ingredientUnits, setIngredientUnits] = useState(() => readCache('units', {}))
    const [ingredientConfigs, setIngredientConfigs] = useState(() => readCache('configs', []))
    const [productExtras, setProductExtras] = useState(() => readCache('extras', {}))
    const [extraIngredients, setExtraIngredients] = useState(() => readCache('extra_ingredients', {}))
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(null)

    const applyData = useCallback((prods, recs, costsResult, extras, extraIngs, addressId) => {
        const { costs, units, rows } = costsResult
        setProducts(prods)
        setRecipes(recs)
        setIngredientCosts(costs)
        setIngredientUnits(units)
        setIngredientConfigs(rows || [])
        setProductExtras(extras)
        setExtraIngredients(extraIngs)
        try {
            const key = (name) => buildCacheKey(addressId || 'default', name)
            localStorage.setItem(key('products'), JSON.stringify(prods))
            localStorage.setItem(key('recipes'), JSON.stringify(recs))
            localStorage.setItem(key('costs'), JSON.stringify(costs))
            localStorage.setItem(key('units'), JSON.stringify(units))
            localStorage.setItem(key('configs'), JSON.stringify(rows || []))
            localStorage.setItem(key('extras'), JSON.stringify(extras))
            localStorage.setItem(key('extra_ingredients'), JSON.stringify(extraIngs))
        } catch { /* ignore quota errors */ }
    }, [])

    useEffect(() => {
        const addressId = selectedAddress?.id

        // Instantly apply address-specific cache while fresh data loads. This is
        // also the offline-fallback path: if the fetch below fails (no network at
        // shift-open), this cache-hydrated state is simply left in place — the POS
        // screen still shows the last-known menu/prices/extras and orders queue
        // into the existing offline-order mechanism.
        setProducts(readCache('products', []))
        setRecipes(readCache('recipes', []))
        setIngredientCosts(readCache('costs', {}))
        setIngredientUnits(readCache('units', {}))
        setIngredientConfigs(readCache('configs', []))
        setProductExtras(readCache('extras', {}))
        setExtraIngredients(readCache('extra_ingredients', {}))

        async function load() {
            try {
                setLoading(true)
                setLoadError(null)
                const [prods, recs, costsResult, extras] = await Promise.all([
                    fetchProducts(addressId),
                    fetchAllRecipes(addressId),
                    fetchIngredientCostsAndUnits(addressId),
                    fetchProductExtras(addressId),
                ])
                const extraIds = Object.values(extras).flat().map(e => e.id)
                const extraIngs = await fetchExtraIngredients(extraIds)
                applyData(prods, recs, costsResult, extras, extraIngs, addressId)
            } catch (error) {
                // Offline-at-shift-open fallback: deliberately do NOT clear products/
                // recipes/etc here. They're already holding the cache snapshot set
                // above, so the POS screen keeps showing the last-known menu/prices
                // instead of going blank. loadError only drives the UI copy ("offline,
                // will sync" vs "no menu yet") — see MenuGrid.
                console.error('Failed to load product data', error)
                setLoadError(error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [activeManagerId, selectedAddress?.id, applyData, readCache])

    const refreshProducts = useCallback(async () => {
        const addressId = selectedAddress?.id
        const [prods, recs, costsResult, extras] = await Promise.all([
            fetchProducts(addressId),
            fetchAllRecipes(addressId),
            fetchIngredientCostsAndUnits(addressId),
            fetchProductExtras(addressId),
        ])
        const extraIds = Object.values(extras).flat().map(e => e.id)
        const extraIngs = await fetchExtraIngredients(extraIds)
        applyData(prods, recs, costsResult, extras, extraIngs, addressId)
    }, [selectedAddress?.id, applyData])

    // Refresh menu/recipe/cost/extras when tab becomes visible again.
    // Replaces a per-address realtime channel that previously held an open
    // WebSocket subscription on 4 tables for every signed-in client. Product
    // data changes infrequently, so an on-focus refetch is sufficient.
    useEffect(() => {
        if (!supabase || !selectedAddress?.id) return

        // Only refetch the 5 product tables if the tab was actually away for a
        // while. Without this, every quick app-switch / lock-screen fires a herd
        // of reads that saturates a flaky connection (a key "lag after foreground"
        // aggravator). Product data changes infrequently → 30s is plenty.
        let hiddenAt = 0
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                hiddenAt = Date.now()
            } else if (Date.now() - hiddenAt > 30000) {
                refreshProducts().catch(() => { })
            }
        }
        document.addEventListener('visibilitychange', handleVisibility)
        return () => document.removeEventListener('visibilitychange', handleVisibility)
    }, [selectedAddress?.id, refreshProducts])

    return (
        <ProductContext.Provider value={{
            products,
            recipes,
            ingredientCosts,
            ingredientUnits,
            ingredientConfigs,
            productExtras,
            extraIngredients,
            refreshProducts,
            loading,
            loadError
        }}>
            <Outlet />
        </ProductContext.Provider>
    )
}
