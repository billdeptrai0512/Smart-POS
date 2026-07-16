import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { useMonetizationEnabled } from '../hooks/useEntitlement'
import { fetchBranchesTodayStats, fetchStaffByManager, fetchSubscriptionStatuses } from '../services/authService'

const AddressStatsContext = createContext(null)

// ponytail: hook co-located with its Provider (standard context pattern) —
// splitting into its own file isn't worth the diff for a fast-refresh (dev-only HMR) nag.
// eslint-disable-next-line react-refresh/only-export-components
export function useAddressStats() {
    const ctx = useContext(AddressStatsContext)
    if (!ctx) throw new Error('useAddressStats must be used within AddressStatsProvider')
    return ctx
}

// Holds dashboard stats (cups, revenue, active sessions, staff list) above the
// route level so navigating /addresses ↔ /pos doesn't unmount + refetch. The
// AddressSelectPage reads from cache instantly and revalidates in background.
export function AddressStatsProvider() {
    const { profile, isStaff } = useAuth()
    const { addresses } = useAddress()
    const { enabled: monetizationEnabled } = useMonetizationEnabled()

    const [cupsMap, setCupsMap] = useState({})
    const [revenueMap, setRevenueMap] = useState({})
    const [prevCupsMap, setPrevCupsMap] = useState({})
    const [sessionsMap, setSessionsMap] = useState({})
    const [subscriptionStatusMap, setSubscriptionStatusMap] = useState({})
    const [subscriptionRowsMap, setSubscriptionRowsMap] = useState({})
    // true ngay từ đầu (giả định đang tải) — tránh badge render "Chưa đăng ký" sai
    // trong 1 frame trước khi effect bên dưới kịp chạy và set lại giá trị thật.
    const [subscriptionLoading, setSubscriptionLoading] = useState(true)
    const [staffList, setStaffList] = useState([])
    const [statsLoading, setStatsLoading] = useState(false)
    const [staffLoading, setStaffLoading] = useState(false)

    const addressIdsKey = useMemo(() => addresses.map(a => a.id).join('|'), [addresses])
    const cancelRef = useRef(false)

    const loadStats = useCallback(async () => {
        if (!addresses.length) return
        const addrIds = addresses.map(a => a.id)
        setStatsLoading(true)
        try {
            // 1 RPC duy nhất trả cả stats + sessions (kèm tên/role) + prev — was 3 round-trips.
            const { cupsMap: cups, revenueMap: revenue, prevCupsMap: prevCups, sessionsMap: sessions } = await fetchBranchesTodayStats(addrIds)
            if (cancelRef.current) return
            const filledCups = {}, filledRev = {}
            addrIds.forEach(id => {
                filledCups[id] = cups[id] ?? 0
                filledRev[id] = revenue[id] ?? 0
            })
            setCupsMap(filledCups)
            setRevenueMap(filledRev)
            setPrevCupsMap(prevCups)
            setSessionsMap(sessions)
        } finally {
            if (!cancelRef.current) setStatsLoading(false)
        }
    }, [addresses])

    // Trạng thái gói dùng để sort BranchGrid (dùng thử → đã đăng ký → chưa đăng ký).
    // Không gọi khi monetization tắt — cột address_subscriptions vô nghĩa lúc đó.
    const loadSubscriptionStatuses = useCallback(async () => {
        if (!monetizationEnabled || !addresses.length) {
            setSubscriptionStatusMap({})
            setSubscriptionRowsMap({})
            setSubscriptionLoading(false)
            return
        }
        setSubscriptionLoading(true)
        const { statusMap, rowsMap } = await fetchSubscriptionStatuses(addresses.map(a => a.id))
        if (cancelRef.current) return
        setSubscriptionStatusMap(statusMap)
        setSubscriptionRowsMap(rowsMap)
        setSubscriptionLoading(false)
    }, [addresses, monetizationEnabled])

    // Expose để SubscriptionPanel gọi lại sau Mock/Reset gói (admin) — làm tươi cả
    // rows (badge từng card + panel) lẫn status (thứ tự sort) trong 1 lần refetch.
    useEffect(() => {
        loadSubscriptionStatuses()
    }, [addressIdsKey, monetizationEnabled, loadSubscriptionStatuses])

    const loadStaff = useCallback(async () => {
        if (!profile?.id || isStaff) return
        setStaffLoading(true)
        try {
            const list = await fetchStaffByManager(profile.id)
            if (!cancelRef.current) setStaffList(list)
        } finally {
            if (!cancelRef.current) setStaffLoading(false)
        }
    }, [profile?.id, isStaff])

    useEffect(() => {
        cancelRef.current = false
        if (!addresses.length) {
            setStatsLoading(false)
            return
        }
        loadStats()

        const intervalId = setInterval(() => {
            if (document.visibilityState === 'visible') loadStats()
        }, 30_000)

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') loadStats()
        }
        document.addEventListener('visibilitychange', handleVisibility)
        return () => {
            cancelRef.current = true
            clearInterval(intervalId)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
        // ponytail: keyed on addressIdsKey (ids only) — addresses.length is only an
        // early-bail snapshot, not something that should restart the poll interval.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressIdsKey, loadStats])

    useEffect(() => {
        loadStaff()
    }, [loadStaff])

    return (
        <AddressStatsContext.Provider value={{
            cupsMap,
            revenueMap,
            prevCupsMap,
            sessionsMap,
            subscriptionStatusMap,
            subscriptionRowsMap,
            subscriptionLoading,
            staffList,
            statsLoading,
            staffLoading,
            refreshStats: loadStats,
            refreshStaff: loadStaff,
            refreshSubscriptionStatuses: loadSubscriptionStatuses,
        }}>
            <Outlet />
        </AddressStatsContext.Provider>
    )
}
