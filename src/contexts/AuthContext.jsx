import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { signIn as authSignIn, signOut as authSignOut, signUp as authSignUp, signUpWithInvite as authSignUpWithInvite, fetchProfileByAuthId, removeSession } from '../services/authService'
import { isGuest as getLocalIsGuest, setIsGuest as setLocalIsGuest, initializeGuestFromGlobal, clearGuestData } from '../services/localRepository'

const AuthContext = createContext(null)

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)       // Supabase auth user
    const [profile, setProfile] = useState(null)  // User profile row (from 'users' table)
    const [loading, setLoading] = useState(true)
    const [isGuest, setIsGuestState] = useState(() => getLocalIsGuest())

    // initGuestMode: called from LoginPage when user clicks "Dùng thử miễn phí"
    // Fetches the global default setup from Supabase (address_id IS NULL) and seeds localStorage
    const initGuestMode = useCallback(async () => {
        setLoading(true)
        try {
            // IMPORTANT: Clear guest flag temporarily to ensure orderService fetches from Supabase
            // instead of trying to read from an empty localStorage
            setLocalIsGuest(false)

            const { 
                fetchProducts, 
                fetchAllRecipes, 
                fetchIngredientCostsAndUnits,
                fetchProductExtras,
                fetchExtraIngredients
            } = await import('../services/orderService')

            const [products, recipes, ingredientData, extrasMap, extraIngsMap] = await Promise.all([
                fetchProducts(null),
                fetchAllRecipes(null),
                fetchIngredientCostsAndUnits(null),
                fetchProductExtras(null),
                fetchExtraIngredients(null)
            ])

            // Flatten maps into arrays for storage
            const extras = Object.values(extrasMap).flat()
            const extraIngredients = Object.values(extraIngsMap).flat()

            // Seed localStorage with the fetched global data
            initializeGuestFromGlobal({ 
                products, 
                recipes, 
                ingredients: ingredientData.rows,
                extras,
                extraIngredients
            })
        } catch (err) {
            console.error('[Guest] Failed to fetch global setup, using empty sandbox:', err)
        } finally {
            // Only NOW flip the guest flag — data is already in localStorage
            setLocalIsGuest(true)
            setIsGuestState(true)
            setLoading(false)
        }
    }, [])

    // setIsGuest(false) resets guest state without fetching
    const setIsGuest = useCallback((val) => {
        setIsGuestState(val)
        setLocalIsGuest(val)
    }, [])

    // Load profile when auth user changes
    const loadProfile = useCallback(async (authUser) => {
        if (!authUser) {
            setProfile(null)
            return
        }

        // Retry fetching profile in case it's a new sign-up and the insert hasn't completed yet
        let pf = null
        let retries = 3
        while (!pf && retries > 0) {
            pf = await fetchProfileByAuthId(authUser.id)
            if (pf) break
            await new Promise(res => setTimeout(res, 500))
            retries--
        }

        setProfile(pf)
    }, [])

    // Initialize: check existing session
    useEffect(() => {
        if (!supabase) {
            setLoading(false)
            return
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            const authUser = session?.user ?? null
            setUser(authUser)
            if (authUser) {
                setIsGuest(false)
                loadProfile(authUser).finally(() => setLoading(false))
            } else if (getLocalIsGuest()) {
                // Returning guest (page refresh) — restore guest profile without fetching
                setIsGuestState(true)
                setProfile({ id: 'guest', name: 'Khách Ghé Thăm', role: 'manager', email: 'guest@demo.local' })
                setLoading(false)
            } else {
                // No session, not a returning guest → show login page
                setLoading(false)
            }
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            const authUser = session?.user ?? null
            setUser(authUser)
            if (authUser) {
                setIsGuest(false)
                loadProfile(authUser)
            }
            // On sign-out: do NOT auto-guest; user must click "Dùng thử" on LoginPage
        })

        return () => subscription.unsubscribe()
    }, [loadProfile])

    const signIn = useCallback(async (username, password) => {
        const data = await authSignIn(username, password)
        // Auth state change listener will handle setting user/profile
        return data
    }, [])

    const signOut = useCallback(async () => {
        if (profile?.id) await removeSession(profile.id)
        await authSignOut()
        setUser(null)
        setProfile(null)
    }, [profile])

    const signUp = useCallback(async (username, password, name, email = null) => {
        const data = await authSignUp(username, password, name, email)
        setUser(data.user)
        setProfile(data.profile)
        // Transition from guest to real user — clear sandbox
        clearGuestData()
        setIsGuest(false)
        return data
    }, [])

    const signUpWithInvite = useCallback(async (token, username, password, name) => {
        const data = await authSignUpWithInvite(token, username, password, name)
        setUser(data.user)
        setProfile(data.profile)
        // Transition from guest to real user — clear sandbox
        clearGuestData()
        setIsGuest(false)
        return data
    }, [])

    const isManager = profile?.role === 'manager' || profile?.role === 'co-manager'
    const isStaff = profile?.role === 'staff'
    const isAdmin = profile?.role === 'admin'

    return (
        <AuthContext.Provider value={{ user, profile, loading, isGuest, setIsGuest, initGuestMode, signIn, signUp, signUpWithInvite, signOut, isManager, isStaff, isAdmin }}>
            {children}
        </AuthContext.Provider>
    )
}
