import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
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
    const [productExtras, setProductExtras] = useState(() => readCache('extras', {}))
    const [extraIngredients, setExtraIngredients] = useState(() => readCache('extra_ingredients', {}))
    const [loading, setLoading] = useState(true)

    const applyData = useCallback((prods, recs, costsResult, extras, extraIngs, addressId) => {
        const { costs, units } = costsResult
        setProducts(prods)
        setRecipes(recs)
        setIngredientCosts(costs)
        setIngredientUnits(units)
        setProductExtras(extras)
        setExtraIngredients(extraIngs)
        try {
            const key = (name) => `cache_${name}_${addressId || 'default'}`
            localStorage.setItem(key('products'), JSON.stringify(prods))
            localStorage.setItem(key('recipes'), JSON.stringify(recs))
            localStorage.setItem(key('costs'), JSON.stringify(costs))
            localStorage.setItem(key('units'), JSON.stringify(units))
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
                const [prods, recs, costsResult, extras, extraIngs] = await Promise.all([
                    fetchProducts(addressId),
                    fetchAllRecipes(addressId),
                    fetchIngredientCostsAndUnits(addressId),
                    fetchProductExtras(addressId),
                    fetchExtraIngredients()
                ])
                applyData(prods, recs, costsResult, extras, extraIngs, addressId)
            } catch (error) {
                console.error('Failed to load product data', error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [activeManagerId, selectedAddress?.id])

    const refreshProducts = useCallback(async () => {
        const addressId = selectedAddress?.id
        const [prods, recs, costsResult, extras, extraIngs] = await Promise.all([
            fetchProducts(addressId),
            fetchAllRecipes(addressId),
            fetchIngredientCostsAndUnits(addressId),
            fetchProductExtras(addressId),
            fetchExtraIngredients()
        ])
        applyData(prods, recs, costsResult, extras, extraIngs, addressId)
    }, [activeManagerId, selectedAddress?.id])

    return (
        <ProductContext.Provider value={{
            products,
            recipes,
            ingredientCosts,
            ingredientUnits,
            productExtras,
            extraIngredients,
            refreshProducts,
            loading
        }}>
            <Outlet />
        </ProductContext.Provider>
    )
}
