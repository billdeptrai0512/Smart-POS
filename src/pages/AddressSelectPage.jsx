import { useState, useEffect, useRef, useMemo } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { fetchBranchesTodayStats, fetchActiveSessions, fetchStaffByManager, createInviteToken } from '../services/authService'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { LogOut, Loader } from 'lucide-react'
import Skeleton from '../components/common/Skeleton'
import BackupModal from '../components/AddressSelectPage/BackupModal'
import AddressHeader from '../components/AddressSelectPage/AddressHeader'
import BranchGrid from '../components/AddressSelectPage/BranchGrid'
import StaffTab from '../components/AddressSelectPage/StaffTab'

export default function AddressSelectPage() {
    const { addresses, setSelectedAddress, createNewAddress, renameAddress, removeAddress, loading, fetchError } = useAddress()
    const { signOut, profile, isStaff, isAdmin } = useAuth()
    const navigate = useNavigate()

    const [activeTab, setActiveTab] = useState('branches')
    const [error, setError] = useState('')
    const [cupsMap, setCupsMap] = useState({})
    const [revenueMap, setRevenueMap] = useState({})
    const [sessionsMap, setSessionsMap] = useState({})
    const [statsLoading, setStatsLoading] = useState(false)
    const [backupSource, setBackupSource] = useState(null)
    const [newAddressName, setNewAddressName] = useState('')
    const [creating, setCreating] = useState(false)
    const createGuardRef = useRef(false)

    // Staff tab state
    const [staffList, setStaffList] = useState([])
    const [staffLoading, setStaffLoading] = useState(false)
    const [staffInviteLink, setStaffInviteLink] = useState('')
    const [staffInviteExpiry, setStaffInviteExpiry] = useState(null)
    const [generatingStaffLink, setGeneratingStaffLink] = useState(false)
    const [coManagerInviteLink, setCoManagerInviteLink] = useState('')
    const [coManagerInviteExpiry, setCoManagerInviteExpiry] = useState(null)
    const [generatingCoManagerLink, setGeneratingCoManagerLink] = useState(false)

    // Stable signature of address IDs — changes only when an address is added/removed,
    // not on rename. Avoids re-running the heavy prefetch + stats effects unnecessarily.
    const addressIdsKey = useMemo(() => addresses.map(a => a.id).join('|'), [addresses])

    // Track which IDs we've already prefetched so renames/new addresses don't refetch all.
    const prefetchedIdsRef = useRef(new Set())

    // Background prefetch ProductContext data into cache (only for new addresses).
    useEffect(() => {
        if (!addresses.length) return
        const newAddrs = addresses.filter(a => !prefetchedIdsRef.current.has(a.id))
        if (!newAddrs.length) return
        newAddrs.forEach(async addr => {
            prefetchedIdsRef.current.add(addr.id)
            try {
                const [prods, recs, costsResult, extras] = await Promise.all([
                    fetchProducts(addr.id),
                    fetchAllRecipes(addr.id),
                    fetchIngredientCostsAndUnits(addr.id),
                    fetchProductExtras(addr.id),
                ])
                const extraIds = Object.values(extras).flat().map(e => e.id)
                const extraIngs = await fetchExtraIngredients(extraIds)
                const { costs, units } = costsResult
                const key = name => `cache_${name}_${addr.id}`
                try {
                    localStorage.setItem(key('products'), JSON.stringify(prods))
                    localStorage.setItem(key('recipes'), JSON.stringify(recs))
                    localStorage.setItem(key('costs'), JSON.stringify(costs))
                    localStorage.setItem(key('units'), JSON.stringify(units))
                    localStorage.setItem(key('extras'), JSON.stringify(extras))
                    localStorage.setItem(key('extra_ingredients'), JSON.stringify(extraIngs))
                } catch { /* ignore quota */ }
            } catch {
                // Allow retry on next render if prefetch failed
                prefetchedIdsRef.current.delete(addr.id)
            }
        })
    }, [addressIdsKey])

    // Fetch branch stats — when address set changes, on mount, and when the
    // tab becomes visible again (so /pos → /addresses or returning from
    // another tab reflects fresh numbers without manual refresh).
    useEffect(() => {
        if (!addresses.length) {
            setStatsLoading(false)
            return
        }
        const addrIds = addresses.map(a => a.id)
        let cancelled = false

        const loadStats = () => {
            setStatsLoading(true)
            return Promise.all([
                fetchBranchesTodayStats(addrIds),
                fetchActiveSessions(addrIds)
            ]).then(([{ cupsMap: cups, revenueMap: revenue }, sessions]) => {
                if (cancelled) return
                // Normalize: fill 0 for addresses with no orders today so each
                // address always has a defined entry. BranchGrid relies on
                // `cupsMap[addr.id] !== undefined` for stale-while-revalidate.
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
            }).finally(() => {
                if (!cancelled) setStatsLoading(false)
            })
        }

        loadStats()

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') loadStats()
        }
        document.addEventListener('visibilitychange', handleVisibility)
        return () => {
            cancelled = true
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [addressIdsKey])

    // Fetch staff list for manager (needed for header count + staff tab)
    useEffect(() => {
        if (!profile?.id || isStaff) return
        setStaffLoading(true)
        fetchStaffByManager(profile.id)
            .then(setStaffList)
            .finally(() => setStaffLoading(false))
    }, [profile?.id, isStaff])

    function handleSelect(addr) {
        setSelectedAddress(addr)
        navigate('/pos', { replace: true })
    }

    async function handleCreateNew(name) {
        const addr = await createNewAddress(name)
        handleSelect(addr)
    }

    async function handleCreateFromFooter() {
        if (!newAddressName.trim()) return
        if (createGuardRef.current) return
        createGuardRef.current = true
        setCreating(true)
        setError('')
        try {
            await handleCreateNew(newAddressName.trim())
            setNewAddressName('')
        } catch (err) {
            setError(err.message || 'Không thể tạo địa chỉ')
        } finally {
            setCreating(false)
            createGuardRef.current = false
        }
    }

    async function handleGenerateInvite(role) {
        if (!profile?.id) return
        const isCoManager = role === 'co-manager'
        const setLink = isCoManager ? setCoManagerInviteLink : setStaffInviteLink
        const setExpiry = isCoManager ? setCoManagerInviteExpiry : setStaffInviteExpiry
        const setGenerating = isCoManager ? setGeneratingCoManagerLink : setGeneratingStaffLink
        setGenerating(true)
        setLink('')
        try {
            const { token, expires_at } = await createInviteToken(profile.id, role)
            setLink(`${window.location.origin}/signup/${token}`)
            setExpiry(new Date(expires_at))
        } catch (err) {
            setError(err.message || 'Không thể tạo link')
        } finally {
            setGenerating(false)
        }
    }

    async function handleSignOut() {
        await signOut()
        navigate('/login', { replace: true })
    }

    const today = new Date()
    const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

    if (loading) {
        return (
            <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
                <div className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
                    <div className="px-6 grid grid-cols-2 gap-3">
                        <Skeleton className="h-24 rounded-[20px]" />
                        <Skeleton className="h-24 rounded-[20px]" />
                    </div>
                </div>
                <div className="px-4 pt-4 space-y-3">
                    <Skeleton className="h-24 rounded-[20px]" />
                    <Skeleton className="h-24 rounded-[20px]" />
                    <Skeleton className="h-24 rounded-[20px]" />
                </div>
            </div>
        )
    }

    const showCreateFooter = !isStaff && activeTab === 'branches'

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <AddressHeader
                isStaff={isStaff}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                profile={profile}
                dateOnly={dateOnly}
                setError={setError}
                addressCount={addresses.length}
                staffCount={staffList.length}
            />

            <div className={`flex-1 overflow-y-auto px-4 pt-4 hide-scrollbar ${showCreateFooter ? 'pb-40' : 'pb-8'}`}>
                {/* ── BRANCHES TAB ── */}
                {(activeTab === 'branches' || isStaff) && (
                    <BranchGrid
                        addresses={addresses}
                        fetchError={fetchError}
                        cupsMap={cupsMap}
                        revenueMap={revenueMap}
                        sessionsMap={sessionsMap}
                        statsLoading={statsLoading}
                        isStaff={isStaff}
                        isAdmin={isAdmin}
                        error={error}
                        setError={setError}
                        onSelect={handleSelect}
                        onBackup={setBackupSource}
                        onRename={renameAddress}
                        onRemove={removeAddress}
                        onDefaultTemplate={() => {
                            setSelectedAddress({ id: null, name: 'Mẫu mặc định' })
                            navigate('/recipes')
                        }}
                    />
                )}

                {/* ── STAFF TAB ── */}
                {activeTab === 'staff' && !isStaff && (
                    <StaffTab
                        staffList={staffList}
                        staffLoading={staffLoading}
                        error={error}
                        onGenerateInvite={handleGenerateInvite}
                        staffInviteLink={staffInviteLink}
                        staffInviteExpiry={staffInviteExpiry}
                        generatingStaffLink={generatingStaffLink}
                        coManagerInviteLink={coManagerInviteLink}
                        coManagerInviteExpiry={coManagerInviteExpiry}
                        generatingCoManagerLink={generatingCoManagerLink}
                    />
                )}

                {/* Sign out */}
                <button
                    onClick={handleSignOut}
                    className="flex items-center justify-center gap-2 w-full mt-6 py-2.5 text-text-secondary text-xs font-bold hover:text-danger transition-colors"
                >
                    <LogOut size={13} />
                    Đăng xuất
                </button>
            </div>

            {/* Footer: Create new address */}
            {showCreateFooter && (
                <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto pointer-events-none z-50">
                    <div className="p-4 bg-surface border-t border-border/60 pointer-events-auto">
                        <div className="flex flex-col gap-3">
                            <input
                                type="text"
                                placeholder="Tên địa chỉ mới..."
                                value={newAddressName}
                                onChange={e => setNewAddressName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFromFooter() }}
                                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            <button
                                onClick={handleCreateFromFooter}
                                disabled={!newAddressName.trim() || creating}
                                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase flex items-center justify-center gap-1.5"
                            >
                                {creating ? <><Loader size={13} className="animate-spin" /> Đang tạo...</> : 'Tạo địa chỉ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Backup Modal */}
            {backupSource && (
                <BackupModal
                    sourceAddress={backupSource}
                    onClose={() => setBackupSource(null)}
                />
            )}
        </div>
    )
}
