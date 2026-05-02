import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useAddress } from './AddressContext'
import { fetchBranchesTodayStats, fetchActiveSessions, fetchStaffByManager } from '../services/authService'

const AddressStatsContext = createContext(null)

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

    const [cupsMap, setCupsMap] = useState({})
    const [revenueMap, setRevenueMap] = useState({})
    const [sessionsMap, setSessionsMap] = useState({})
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
            const [{ cupsMap: cups, revenueMap: revenue }, sessions] = await Promise.all([
                fetchBranchesTodayStats(addrIds),
                fetchActiveSessions(addrIds)
            ])
            if (cancelRef.current) return
            const filledCups = {}, filledRev = {}
            addrIds.forEach(id => {
                filledCups[id] = cups[id] ?? 0
                filledRev[id] = revenue[id] ?? 0
            })
            setCupsMap(filledCups)
            setRevenueMap(filledRev)
            const grouped = {}
            sessions.forEach(s => {
                if (!grouped[s.address_id]) grouped[s.address_id] = []
                grouped[s.address_id].push(s.users?.name || 'Unknown')
            })
            setSessionsMap(grouped)
        } finally {
            if (!cancelRef.current) setStatsLoading(false)
        }
    }, [addresses])

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
    }, [addressIdsKey, loadStats])

    useEffect(() => {
        loadStaff()
    }, [loadStaff])

    return (
        <AddressStatsContext.Provider value={{
            cupsMap,
            revenueMap,
            sessionsMap,
            staffList,
            statsLoading,
            staffLoading,
            refreshStats: loadStats,
            refreshStaff: loadStaff,
        }}>
            <Outlet />
        </AddressStatsContext.Provider>
    )
}
