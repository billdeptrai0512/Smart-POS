import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { supabase } from '../lib/supabaseClient'
import { Outlet } from 'react-router-dom'

const ProductContext = createContext(null)

export function useProducts() {
    const ctx = useContext(ProductContext)
    if (!ctx) throw new Error('useProducts must be used within ProductProvider')
    return ctx
}

export function ProductProvider() {
    const { profile } = useAuth()
    const activeManagerId = profile?.role === 'manager' ? profile.id : profile?.manager_id
    const { selectedAddress } = useAddress()

    const cacheKey = (name) => `cache_${name}_${selectedAddress?.id || 'default'}`

    const readCache = (name, fallback) => {
        try {
            const cached = localStorage.getItem(cacheKey(name))
            return cached ? JSON.parse(cached) : fallback
        } catch { return fallback }
    }

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
            const key = (name) => `cache_${name}_${addressId || 'default'}`
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

        // Instantly apply address-specific cache while fresh data loads
        setProducts(readCache('products', []))
        setRecipes(readCache('recipes', []))
        setIngredientCosts(readCache('costs', {}))
        setIngredientUnits(readCache('units', {}))
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
                console.error('Failed to load product data', error)
                setLoadError(error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [activeManagerId, selectedAddress?.id])

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
    }, [activeManagerId, selectedAddress?.id, applyData])

    // Refresh menu/recipe/cost/extras when tab becomes visible again.
    // Replaces a per-address realtime channel that previously held an open
    // WebSocket subscription on 4 tables for every signed-in client. Product
    // data changes infrequently, so an on-focus refetch is sufficient.
    useEffect(() => {
        if (!supabase || !selectedAddress?.id) return

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
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
