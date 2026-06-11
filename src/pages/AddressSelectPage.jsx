import { useState, useEffect, useRef, useMemo } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAddressStats } from '../contexts/AddressStatsContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { createInviteToken, fetchDefaultIngredientSort, setTeamMemberRole, removeTeamMember, setMyPhone } from '../services/authService'
import { useMonetizationEnabled } from '../hooks/useEntitlement'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { LogOut, Loader, Plus, X, UserPlus } from 'lucide-react'
import Skeleton from '../components/common/Skeleton'
import BackupModal from '../components/AddressSelectPage/BackupModal'
import AddressHeader from '../components/AddressSelectPage/AddressHeader'
import BranchGrid from '../components/AddressSelectPage/BranchGrid'
import StaffTab from '../components/AddressSelectPage/StaffTab'
import { cacheKey as buildCacheKey } from '../constants/storageKeys'

export default function AddressSelectPage() {
    const { addresses, setSelectedAddress, createNewAddress, renameAddress, removeAddress, loading, fetchError } = useAddress()
    const { cupsMap, revenueMap, sessionsMap, staffList, staffLoading, statsLoading, refreshStaff } = useAddressStats()
    const { signOut, profile, refreshProfile, isStaff, isAdmin, isGuest } = useAuth()
    const { enabled: monetizationEnabled } = useMonetizationEnabled()
    const navigate = useNavigate()

    const [activeTab, setActiveTab] = useState('branches')
    const [staffSubTab, setStaffSubTab] = useState('staff')
    const [error, setError] = useState('')
    const [backupSource, setBackupSource] = useState(null)
    const [newAddressName, setNewAddressName] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [creating, setCreating] = useState(false)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const createGuardRef = useRef(false)

    // Staff tab invite state
    const [staffInviteLink, setStaffInviteLink] = useState('')
    const [staffInviteExpiry, setStaffInviteExpiry] = useState(null)
    const [generatingStaffLink, setGeneratingStaffLink] = useState(false)
    const [coManagerInviteLink, setCoManagerInviteLink] = useState('')
    const [coManagerInviteExpiry, setCoManagerInviteExpiry] = useState(null)
    const [generatingCoManagerLink, setGeneratingCoManagerLink] = useState(false)

    // Stable signature of address IDs — changes only when an address is added/removed,
    // not on rename. Avoids re-running the heavy prefetch + stats effects unnecessarily.
    const addressIdsKey = useMemo(() => addresses.map(a => a.id).join('|'), [addresses])

    // PERF: count by role in a single pass instead of two .filter() walks per render.
    const { staffCount, managerCount } = useMemo(() => {
        let s = 0, m = 0
        for (const u of staffList) {
            if (u.role === 'staff') s++
            else if (u.role === 'manager' || u.role === 'co-manager') m++
        }
        return { staffCount: s, managerCount: m }
    }, [staffList])

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
                const key = name => buildCacheKey(addr.id, name)
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

    function handleSelect(addr) {
        setSelectedAddress(addr)
        navigate('/pos', { replace: true })
    }

    function handleSelectReport(addr) {
        setSelectedAddress(addr)
        navigate('/daily-report', { state: { from: '/addresses' } })
    }

    function handleSelectHistory(addr) {
        setSelectedAddress(addr)
        navigate('/history', { state: { from: '/addresses' } })
    }

    function handleSelectIngredients(addr) {
        setSelectedAddress(addr)
        navigate('/ingredients', { state: { from: '/addresses' } })
    }

    async function handleCreateNew(name) {
        const addr = await createNewAddress(name)
        handleSelect(addr)
    }

    // Mồi nhập SĐT ngay trong modal tạo chi nhánh: trigger trial chỉ cấp khi
    // owner ĐÃ có phone, nên phải lưu phone TRƯỚC khi insert address.
    const needPhone = monetizationEnabled && !isGuest && !profile?.phone

    async function handleCreate() {
        if (!newAddressName.trim()) return
        if (createGuardRef.current) return
        createGuardRef.current = true
        setCreating(true)
        setError('')
        try {
            if (needPhone && newPhone.trim()) {
                await setMyPhone(newPhone.trim())
                refreshProfile()
            }
            await handleCreateNew(newAddressName.trim())
            setNewAddressName('')
            setNewPhone('')
            setShowCreateModal(false)
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

    async function handleSetMemberRole(memberId, role) {
        await setTeamMemberRole(memberId, role)
        await refreshStaff()
    }

    async function handleRemoveMember(memberId) {
        await removeTeamMember(memberId)
        await refreshStaff()
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

    const showCreate = !isStaff && activeTab === 'branches'
    const showInvite = activeTab === 'staff' && !isStaff && !isGuest
    const inviteGenerating = staffSubTab === 'staff' ? generatingStaffLink : generatingCoManagerLink

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg relative">
            <AddressHeader
                isStaff={isStaff}
                isGuest={isGuest}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                profile={profile}
                dateOnly={dateOnly}
                setError={setError}
                addressCount={addresses.length}
                staffCount={staffCount}
                managerCount={managerCount}
            />

            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4 hide-scrollbar">
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
                        onSelectReport={handleSelectReport}
                        onSelectHistory={handleSelectHistory}
                        onSelectIngredients={handleSelectIngredients}
                        onBackup={setBackupSource}
                        onRename={renameAddress}
                        onRemove={removeAddress}
                        onDefaultTemplate={async () => {
                            // Load persisted ingredient sort so /ingredients respects admin's saved order.
                            const ingredient_sort_order = await fetchDefaultIngredientSort()
                            setSelectedAddress({ id: null, name: 'Mẫu mặc định', ingredient_sort_order })
                            navigate('/recipes')
                        }}
                    />
                )}

                {/* ── STAFF TAB ── */}
                {activeTab === 'staff' && !isStaff && !isGuest && (
                    <StaffTab
                        staffList={staffList}
                        staffLoading={staffLoading}
                        error={error}
                        staffInviteLink={staffInviteLink}
                        staffInviteExpiry={staffInviteExpiry}
                        coManagerInviteLink={coManagerInviteLink}
                        coManagerInviteExpiry={coManagerInviteExpiry}
                        onSetMemberRole={handleSetMemberRole}
                        onRemoveMember={handleRemoveMember}
                        subTab={staffSubTab}
                        setSubTab={setStaffSubTab}
                    />
                )}
            </div>

            {/* Bottom action bar — Đăng xuất (left) + primary CTA (right) */}
            <div className="shrink-0 flex items-stretch justify-between gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] bg-surface border-t border-border/60">
                <button
                    onClick={handleSignOut}
                    className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-[12px] border border-border/60 bg-bg px-4 py-3 text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light hover:text-danger active:scale-95 transition-all"
                >
                    <LogOut size={16} className="shrink-0" />
                    <span className="truncate">Đăng xuất</span>
                </button>

                {showCreate && (
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-[12px] bg-primary px-4 py-3 text-[13px] font-black uppercase text-bg hover:bg-primary/90 active:scale-95 transition-all"
                    >
                        <Plus size={16} className="shrink-0" />
                        <span className="truncate">Tạo địa chỉ</span>
                    </button>
                )}

                {showInvite && (
                    <button
                        onClick={() => handleGenerateInvite(staffSubTab === 'co-manager' ? 'co-manager' : 'staff')}
                        disabled={inviteGenerating}
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 rounded-[12px] bg-primary px-4 py-3 text-[13px] font-black uppercase text-bg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
                    >
                        {inviteGenerating
                            ? <><Loader size={14} className="animate-spin shrink-0" /> <span className="truncate">Đang tạo...</span></>
                            : <><UserPlus size={16} className="shrink-0" /> <span className="truncate">{staffSubTab === 'staff' ? 'Mời nhân viên' : 'Mời quản lý'}</span></>}
                    </button>
                )}
            </div>

            {/* Slide-up Tạo địa chỉ mới modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[100] flex items-end justify-center" onClick={() => !creating && setShowCreateModal(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-[16px] font-black text-text">Tạo địa chỉ mới</span>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                disabled={creating}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <input
                                type="text"
                                autoFocus
                                placeholder="Tên địa chỉ mới..."
                                value={newAddressName}
                                onChange={e => setNewAddressName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            {needPhone && (
                                <div className="flex flex-col gap-1.5">
                                    <input
                                        type="tel"
                                        placeholder="Số điện thoại (vd: 0901234567)"
                                        value={newPhone}
                                        onChange={e => setNewPhone(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                                        className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                                    />
                                    <p className="text-text-secondary text-[11px] px-1">
                                        Nhập SĐT để nhận <span className="font-bold text-text">7 ngày dùng thử báo cáo</span> (1 SĐT = 1 lần). Bỏ trống nếu không cần.
                                    </p>
                                </div>
                            )}
                            <button
                                onClick={handleCreate}
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
