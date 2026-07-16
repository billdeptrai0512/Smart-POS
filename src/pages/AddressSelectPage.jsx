import { useState, useEffect, useRef, useMemo } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAddressStats } from '../contexts/AddressStatsContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { fetchDefaultIngredientSort, setTeamMemberRole, removeTeamMember, setTeamMemberName, setMyPhone } from '../services/authService'
import { useMonetizationEnabled } from '../hooks/useEntitlement'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { cloneFromShareCode, getSharedConfig } from '../services/backupService'
import { LogOut, Loader, Plus, X, UserPlus } from 'lucide-react'
import Skeleton from '../components/common/Skeleton'
import AddressHeader from '../components/AddressSelectPage/AddressHeader'
import BranchGrid from '../components/AddressSelectPage/BranchGrid'
import StaffTab from '../components/AddressSelectPage/StaffTab'
import CreateStaffModal from '../components/AddressSelectPage/CreateStaffModal'
import SupportModal from '../components/common/SupportModal'
import { cacheKey as buildCacheKey } from '../constants/storageKeys'

// Dùng thử → đã đăng ký → chưa đăng ký.
const SUBSCRIPTION_RANK = { trial: 0, paid: 1, none: 2 }

export default function AddressSelectPage() {
    const {
        addresses, setSelectedAddress, createNewAddress, renameAddress, removeAddress, loading, fetchError,
        warehouseGroups, createWarehouseGroup, renameWarehouseGroup, removeWarehouseGroup, setAddressGroup,
    } = useAddress()
    const { cupsMap, revenueMap, prevCupsMap, sessionsMap, subscriptionStatusMap, subscriptionRowsMap, subscriptionLoading, staffList, staffLoading, statsLoading, refreshStaff } = useAddressStats()
    const { signOut, profile, refreshProfile, isStaff, isManager, isAdmin, isGuest } = useAuth()
    const { enabled: monetizationEnabled } = useMonetizationEnabled()
    const navigate = useNavigate()

    const [activeTab, setActiveTab] = useState('branches')
    const [showCreateStaffModal, setShowCreateStaffModal] = useState(false)
    const [error, setError] = useState('')
    const [newAddressName, setNewAddressName] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [newShareCode, setNewShareCode] = useState('')
    const [clonePreview, setClonePreview] = useState(null) // { status: 'loading'|'valid'|'invalid', counts? }
    const [creating, setCreating] = useState(false)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showSupportModal, setShowSupportModal] = useState(false)
    const createGuardRef = useRef(false)

    // Stable signature of address IDs — changes only when an address is added/removed,
    // not on rename. Avoids re-running the heavy prefetch + stats effects unnecessarily.
    const addressIdsKey = useMemo(() => addresses.map(a => a.id).join('|'), [addresses])

    // Staff panel: only show addresses that belong to the caller's team (manager_id
    // matches the team owner). Admin sees ALL addresses globally via is_admin_auth(),
    // but their team members only have access to addresses owned by the admin — so the
    // panel must not display addresses from other teams (whose toggles would be misleading).
    const teamOwnerId = profile?.manager_id || profile?.id
    const teamAddresses = useMemo(() => {
        if (!teamOwnerId) return addresses
        return addresses.filter(a => a.manager_id === teamOwnerId)
    }, [addresses, teamOwnerId])

    // Trong cùng nhóm giữ nguyên thứ tự created_at có sẵn từ query (Array.sort ổn định) làm tie-break phụ.
    const sortedAddresses = useMemo(() => {
        if (!monetizationEnabled) return addresses
        return [...addresses].sort((a, b) =>
            (SUBSCRIPTION_RANK[subscriptionStatusMap[a.id]] ?? 2) - (SUBSCRIPTION_RANK[subscriptionStatusMap[b.id]] ?? 2)
        )
    }, [addresses, subscriptionStatusMap, monetizationEnabled])

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
    // Hoãn 2.5s để ~5 query/địa chỉ không tranh băng thông với query stats lúc login
    // (stats là thứ user đang nhìn skeleton chờ; prefetch chỉ là warm cache).
    useEffect(() => {
        if (!addresses.length) return
        const newAddrs = addresses.filter(a => !prefetchedIdsRef.current.has(a.id))
        if (!newAddrs.length) return
        const timer = setTimeout(() => {
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
        }, 2500)
        return () => clearTimeout(timer)
        // ponytail: keyed on addressIdsKey (ids only), not `addresses` — the array gets a
        // new reference on every refetch even when the id set is unchanged, which would
        // restart this 2.5s prefetch timer on every such refresh.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressIdsKey])

    // Smart clone link: a ?clone=CODE captured at app load (App.CloneCapture) lands here
    // → open "Tạo địa chỉ" with the code pre-filled. Survives login/signup via sessionStorage.
    useEffect(() => {
        const pending = sessionStorage.getItem('pending_clone_code')
        // Chỉ mở cho người TẠO được địa chỉ (manager/admin) — check dương, tránh
        // mở nhầm cho staff lúc profile chưa load xong (isStaff thoáng = false).
        if (pending && (isManager || isAdmin)) {
            setNewShareCode(pending)
            setShowCreateModal(true)
            sessionStorage.removeItem('pending_clone_code')
        }
    }, [isManager, isAdmin])

    // Live preview: when a code is entered, show what it will copy (debounced, read-only).
    useEffect(() => {
        const code = newShareCode.trim()
        if (!code) { setClonePreview(null); return }
        setClonePreview({ status: 'loading' })
        let cancelled = false
        const t = setTimeout(async () => {
            const cfg = await getSharedConfig(code)
            if (cancelled) return
            if (!cfg) {
                setClonePreview({ status: 'invalid' })
            } else {
                setClonePreview({
                    status: 'valid',
                    counts: {
                        products: (cfg.products || []).length,
                        recipes: (cfg.recipes || []).length,
                        costs: (cfg.costs || []).length,
                    },
                })
            }
        }, 400)
        return () => { cancelled = true; clearTimeout(t) }
    }, [newShareCode])

    function handleSelect(addr) {
        setSelectedAddress(addr)
        navigate('/pos', { replace: true })
    }

    function handleSelectReport(addr, initialView) {
        setSelectedAddress(addr)
        navigate('/daily-report', { state: { from: '/addresses', initialView } })
    }

    function handleSelectHistory(addr, tab) {
        setSelectedAddress(addr)
        navigate('/history', { state: { from: '/addresses', tab } })
    }

    function handleSelectIngredients(addr, viewMode) {
        setSelectedAddress(addr)
        navigate('/ingredients', { state: { from: '/addresses', viewMode } })
    }

    function handleSelectRecipes(addr) {
        setSelectedAddress(addr)
        navigate('/recipes', { state: { from: '/addresses' } })
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
        const code = newShareCode.trim()
        let createdId = null
        try {
            if (needPhone && newPhone.trim()) {
                await setMyPhone(newPhone.trim())
                refreshProfile()
            }
            const addr = await createNewAddress(newAddressName.trim().toUpperCase())
            createdId = addr.id
            // Nếu có mã hệ thống → chép toàn bộ cấu hình từ địa chỉ nguồn (xuyên tài khoản).
            if (code) await cloneFromShareCode(code, addr.id)
            setNewAddressName('')
            setNewPhone('')
            setNewShareCode('')
            setShowCreateModal(false)
            handleSelect(addr)
        } catch (err) {
            // Clone lỗi sau khi đã tạo địa chỉ → xoá địa chỉ nửa vời (mirror BackupModal).
            if (createdId && code) {
                try { await removeAddress(createdId) } catch { /* keep original error */ }
            }
            setError(err.message || 'Không thể tạo địa chỉ')
        } finally {
            setCreating(false)
            createGuardRef.current = false
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

    async function handleRenameMember(memberId, name) {
        await setTeamMemberName(memberId, name)
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
                        addresses={sortedAddresses}
                        fetchError={fetchError}
                        cupsMap={cupsMap}
                        revenueMap={revenueMap}
                        prevCupsMap={prevCupsMap}
                        sessionsMap={sessionsMap}
                        subscriptionRowsMap={subscriptionRowsMap}
                        subscriptionLoading={subscriptionLoading}
                        statsLoading={statsLoading}
                        isStaff={isStaff}
                        isAdmin={isAdmin}
                        error={error}
                        setError={setError}
                        onSelect={handleSelect}
                        onSelectReport={handleSelectReport}
                        onSelectHistory={handleSelectHistory}
                        onSelectIngredients={handleSelectIngredients}
                        onSelectRecipes={handleSelectRecipes}
                        onRename={renameAddress}
                        onRemove={removeAddress}
                        warehouseGroups={warehouseGroups}
                        onCreateWarehouseGroup={createWarehouseGroup}
                        onRenameWarehouseGroup={renameWarehouseGroup}
                        onRemoveWarehouseGroup={removeWarehouseGroup}
                        onSetAddressGroup={setAddressGroup}
                        onSupportClick={() => setShowSupportModal(true)}
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
                        addresses={teamAddresses}
                        error={error}
                        onSetMemberRole={handleSetMemberRole}
                        onRemoveMember={handleRemoveMember}
                        onRenameMember={handleRenameMember}
                    />
                )}
            </div>

            {/* Bottom action bar */}
            {activeTab === 'branches' && (
                <div className="shrink-0 flex items-stretch gap-3 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] bg-surface border-t border-border/60">
                    <button
                        onClick={handleSignOut}
                        className="flex-1 min-w-0 flex items-center justify-center rounded-[12px] border border-border/60 bg-bg px-4 py-3 text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light hover:text-danger active:scale-95 transition-all"
                    >
                        <span className="truncate">Đăng xuất</span>
                    </button>
                    {showCreate && (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="flex-1 min-w-0 flex items-center justify-center rounded-[12px] bg-primary px-4 py-3 text-[13px] font-black uppercase text-bg hover:bg-primary/90 active:scale-95 transition-all"
                        >
                            <span className="truncate">Tạo địa chỉ</span>
                        </button>
                    )}
                </div>
            )}
            {showInvite && (
                <div className="shrink-0 flex items-stretch px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] bg-surface border-t border-border/60">
                    <button
                        onClick={() => {
                            setError('')
                            setShowCreateStaffModal(true)
                        }}
                        className="flex-1 min-w-0 flex items-center justify-center rounded-[12px] bg-primary px-4 py-3 text-[13px] font-black uppercase text-bg hover:bg-primary/90 active:scale-95 transition-all"
                    >
                        <span className="truncate">Thêm nhân sự</span>
                    </button>
                </div>
            )}

            {showCreateStaffModal && (
                <CreateStaffModal
                    onClose={() => setShowCreateStaffModal(false)}
                    onSuccess={refreshStaff}
                />
            )}

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
                            <div className="flex flex-col gap-1.5">
                                <input
                                    type="text"
                                    placeholder="Mã hệ thống (nếu có)"
                                    value={newShareCode}
                                    onChange={e => setNewShareCode(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-bold uppercase tracking-wider text-text placeholder:text-text-secondary/50 placeholder:normal-case placeholder:tracking-normal placeholder:font-medium focus:outline-none focus:border-primary/40 transition-colors"
                                />
                                {clonePreview?.status === 'loading' && (
                                    <p className="text-text-secondary text-[11px] px-1 flex items-center gap-1.5">
                                        <Loader size={11} className="animate-spin" /> Đang kiểm tra mã...
                                    </p>
                                )}
                                {clonePreview?.status === 'valid' && (
                                    <p className="text-success text-[11px] font-bold px-1">
                                        ✓ Sẽ chép <span className="tabular-nums">{clonePreview.counts.products}</span> món · <span className="tabular-nums">{clonePreview.counts.recipes}</span> công thức · <span className="tabular-nums">{clonePreview.counts.costs}</span> nguyên liệu
                                    </p>
                                )}
                                {clonePreview?.status === 'invalid' && (
                                    <p className="text-danger text-[11px] font-medium px-1">✗ Mã không đúng hoặc đã hết hạn</p>
                                )}
                                {!clonePreview && (
                                    <p className="text-text-secondary text-[11px] px-1">
                                        Có mã từ chủ hệ thống? Dán vào đây để <span className="font-bold text-text">chép sẵn menu + công thức + định lượng</span>.
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={handleCreate}
                                disabled={!newAddressName.trim() || creating}
                                className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed uppercase flex items-center justify-center gap-1.5"
                            >
                                {creating ? <><Loader size={13} className="animate-spin" /> {newShareCode.trim() ? 'Đang chép cấu hình...' : 'Đang tạo...'}</> : 'Tạo địa chỉ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Support Modal */}
            <SupportModal
                open={showSupportModal}
                onClose={() => setShowSupportModal(false)}
            />
        </div>
    )
}
