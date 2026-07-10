import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { signIn as authSignIn, signOut as authSignOut, signUp as authSignUp, fetchProfileByAuthId, removeSession, fetchDefaultIngredientSort } from '../services/authService'
import { isGuest as getLocalIsGuest, setIsGuest as setLocalIsGuest, initializeGuestFromGlobal, clearGuestData, setGuestIngredientSortOrder } from '../services/localRepository'
import { STORAGE_KEYS } from '../constants/storageKeys'

const AuthContext = createContext(null)

// Cached auth user/profile. On cold start (the OS killed the PWA) we hydrate
// these so the loading gate passes immediately, and — crucially — if the
// launch-time token refresh fails on a flaky connection we keep the user signed
// in instead of bouncing them to /login. Only a real onAuthStateChange
// 'SIGNED_OUT' clears them.
function readCachedAuth(key) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null }
    catch { return null }
}
function cacheAuth(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* quota */ }
}
function clearCachedAuth() {
    localStorage.removeItem(STORAGE_KEYS.AUTH_USER)
    localStorage.removeItem(STORAGE_KEYS.AUTH_PROFILE)
}

// ponytail: hook co-located with its Provider (standard context pattern) —
// 15+ call sites import useAuth from here, splitting into its own file isn't
// worth the diff for a fast-refresh (dev-only HMR) nag.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(() => getLocalIsGuest() ? null : readCachedAuth(STORAGE_KEYS.AUTH_USER))       // Supabase auth user (hydrated from cache on cold start)
    const [profile, setProfile] = useState(() => getLocalIsGuest() ? null : readCachedAuth(STORAGE_KEYS.AUTH_PROFILE))  // User profile row (from 'users' table)
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
                fetchExtraIngredients,
                fetchIngredientStocks
            } = await import('../services/orderService')

            // Step 1 — fetch products/recipes/ingredients/extras/stocks/sort in parallel.
            // Stocks come from the default address (address_id IS NULL) so the playground
            // starts with realistic on-hand quantities instead of zero. The ingredient sort
            // order comes from app_settings so the playground respects admin-curated order.
            const [products, recipes, ingredientData, extrasMap, stocks, defaultSort] = await Promise.all([
                fetchProducts(null),
                fetchAllRecipes(null),
                fetchIngredientCostsAndUnits(null),
                fetchProductExtras(null),
                fetchIngredientStocks(null),
                fetchDefaultIngredientSort(),
            ])

            // Seed the guest's persisted ingredient sort_order so getDemoAddress() returns it.
            if (Array.isArray(defaultSort) && defaultSort.length) {
                setGuestIngredientSortOrder(defaultSort)
            }

            // Step 2 — only fetch extra_ingredients for the default extras we just got.
            // (Previously this called fetchExtraIngredients(null) which scans the whole
            // table — gets slower as more addresses/extras are added.)
            const extras = Object.values(extrasMap).flat()
            const extraIds = extras.map(e => e.id)
            const extraIngsMap = extraIds.length ? await fetchExtraIngredients(extraIds) : {}
            const extraIngredients = Object.values(extraIngsMap).flat()

            // Seed localStorage with the fetched global data
            initializeGuestFromGlobal({
                products,
                recipes,
                ingredients: ingredientData.rows,
                extras,
                extraIngredients,
                stocks
            })
        } catch (err) {
            console.error('[Guest] Failed to fetch global setup, using empty sandbox:', err)
        } finally {
            // Only NOW flip the guest flag — data is already in localStorage.
            // Also set a synthetic manager profile so role-gated UI (canEdit, isManager)
            // unlocks immediately — guest data lives in localStorage so full edit access
            // is safe. Without this, profile stayed null until the next page reload
            // (when the restoration branch in the auth useEffect sets it).
            setLocalIsGuest(true)
            setIsGuestState(true)
            setProfile({ id: 'guest', name: 'Khách Ghé Thăm', role: 'manager', email: 'guest@demo.local' })
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

        // Keep a cached profile across a transient null (network) so we don't blank
        // role-gated UI on a flaky refetch; only overwrite when we actually got one.
        if (pf) {
            setProfile(pf)
            cacheAuth(STORAGE_KEYS.AUTH_PROFILE, pf)
        } else if (!readCachedAuth(STORAGE_KEYS.AUTH_PROFILE)) {
            setProfile(null)
        }
    }, [])

    // Initialize: check existing session
    useEffect(() => {
        if (!supabase) {
            setLoading(false)
            return
        }

        // Get initial session. Run once via finish(); whichever fires first —
        // getSession resolving or the safety valve — wins.
        let settled = false
        const finish = (session) => {
            if (settled) return
            settled = true
            const authUser = session?.user ?? null
            if (authUser) {
                setUser(authUser)
                cacheAuth(STORAGE_KEYS.AUTH_USER, authUser)
                setIsGuest(false)
                // Profile is already hydrated from cache (see useState init), so the UI
                // can render immediately. Don't gate PageLoading on the refetch: on
                // peak-hours / flaky wifi loadProfile retries fetchProfileByAuthId up to
                // 3×500ms (+ slow network each), freezing the whole app on the loading
                // skeleton for seconds. Release now and refresh in the background; only a
                // genuine first launch (no cache, role-gating needs the profile) waits.
                if (readCachedAuth(STORAGE_KEYS.AUTH_PROFILE)) {
                    setLoading(false)
                    loadProfile(authUser)
                } else {
                    loadProfile(authUser).finally(() => setLoading(false))
                }
            } else if (getLocalIsGuest()) {
                // Returning guest (page refresh) — restore guest profile without fetching
                setIsGuestState(true)
                setProfile({ id: 'guest', name: 'Khách Ghé Thăm', role: 'manager', email: 'guest@demo.local' })
                setLoading(false)
            } else if (readCachedAuth(STORAGE_KEYS.AUTH_USER)) {
                // We had a real session but getSession came back empty (or too slow) —
                // on a flaky launch that's a failed/hung token refresh, NOT a sign-out.
                // Stay in (cached user/profile already hydrated); a genuine sign-out
                // arrives below as 'SIGNED_OUT' and clears us out.
                setLoading(false)
            } else {
                // No session, never logged in → show login page
                setLoading(false)
            }
        }
        supabase.auth.getSession().then(({ data: { session } }) => finish(session))
        // Safety valve: getSession refreshes an expired token over the network with
        // NO timeout, so it can hang ~30s on a dead connection and freeze the loading
        // gate. If we already have a cached session, stop blocking after 2.5s and let
        // onAuthStateChange reconcile once the refresh eventually resolves.
        const valve = setTimeout(() => {
            if (readCachedAuth(STORAGE_KEYS.AUTH_USER)) finish(null)
        }, 2500)

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                // The only definitive sign-out signal — now it's safe to drop the user
                // and the cached credentials (a flaky refresh never reaches here).
                setUser(null)
                setProfile(null)
                clearCachedAuth()
                return
            }
            const authUser = session?.user ?? null
            if (authUser) {
                setUser(authUser)
                cacheAuth(STORAGE_KEYS.AUTH_USER, authUser)
                setIsGuest(false)
                loadProfile(authUser)
            }
        })

        return () => { clearTimeout(valve); subscription.unsubscribe() }
    }, [loadProfile, setIsGuest])

    const signIn = useCallback(async (username, password) => {
        const data = await authSignIn(username, password)
        // Auth state change listener will handle setting user/profile.
        // Transition from guest sandbox → real account: clear local guest data so stale
        // guest_* keys don't linger (signUp / signUpWithInvite already do this). Only after
        // a SUCCESSFUL sign-in, so a failed attempt doesn't wipe an active guest session.
        clearGuestData()
        // Account switch on a shared device → drop the previous user's cached address.
        localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ)
        setIsGuest(false)
        return data
    }, [setIsGuest])

    const signOut = useCallback(async () => {
        if (profile?.id) await removeSession(profile.id)
        await authSignOut()
        clearCachedAuth()
        // Drop the cached address OBJECT so a different user signing in on a shared
        // device doesn't briefly see the previous branch name (the SELECTED_ADDRESS
        // id stays, so the SAME user's selection still auto-restores after refetch).
        localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS_OBJ)
        setUser(null)
        setProfile(null)
    }, [profile])

    const signUp = useCallback(async (username, password, name, email = null) => {
        const data = await authSignUp(username, password, name, email)
        setUser(data.user)
        setProfile(data.profile)
        cacheAuth(STORAGE_KEYS.AUTH_USER, data.user)
        cacheAuth(STORAGE_KEYS.AUTH_PROFILE, data.profile)
        // Transition from guest to real user — clear sandbox
        clearGuestData()
        setIsGuest(false)
        return data
    }, [setIsGuest])


    // Re-fetch profile row (vd: sau khi lưu SĐT qua set_my_phone)
    const refreshProfile = useCallback(() => loadProfile(user), [user, loadProfile])

    const isManager = profile?.role === 'manager' || profile?.role === 'co-manager'
    const isStaff = profile?.role === 'staff'
    const isAdmin = profile?.role === 'admin'

    return (
        <AuthContext.Provider value={{ user, profile, loading, isGuest, setIsGuest, initGuestMode, signIn, signUp, signOut, refreshProfile, isManager, isStaff, isAdmin }}>
            {children}
        </AuthContext.Provider>
    )
}
