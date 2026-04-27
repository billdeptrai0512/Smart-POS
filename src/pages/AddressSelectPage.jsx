import { useState, useEffect } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { fetchBranchTodayCups, fetchActiveSessions, fetchStaffByManager, createInviteToken } from '../services/authService'
import { fetchProducts, fetchAllRecipes, fetchIngredientCostsAndUnits, fetchProductExtras, fetchExtraIngredients } from '../services/orderService'
import { supabase } from '../lib/supabaseClient'
import {
    Building2, Users, Pencil, Trash2, ClipboardCopy, ChevronRight,
    Coffee, UserCircle2, LogOut, Plus, Copy, Check, Loader
} from 'lucide-react'
import RealtimeNotification from '../components/POSPage/RealtimeNotification'
import ErrorBanner from '../components/common/ErrorBanner'
import Skeleton from '../components/common/Skeleton'
import BackupModal from '../components/AddressSelectPage/BackupModal'

export default function AddressSelectPage() {
    const { addresses, setSelectedAddress, createNewAddress, renameAddress, removeAddress, loading } = useAddress()
    const { signOut, profile, isStaff, isAdmin } = useAuth()
    const navigate = useNavigate()

    const [activeTab, setActiveTab] = useState('branches')

    // Branch tab state
    const [newName, setNewName] = useState('')
    const [creating, setCreating] = useState(false)
    const [showForm, setShowForm] = useState(false)
    const [error, setError] = useState('')
    const [editingAddressId, setEditingAddressId] = useState(null)
    const [editName, setEditName] = useState('')
    const [realtimeNotification, setRealtimeNotification] = useState(null)
    const [cupsMap, setCupsMap] = useState({})
    const [sessionsMap, setSessionsMap] = useState({})
    const [statsLoading, setStatsLoading] = useState(false)
    const [backupSource, setBackupSource] = useState(null)
    const [deletingAddressId, setDeletingAddressId] = useState(null)

    // Staff tab state
    const [staffList, setStaffList] = useState([])
    const [staffLoading, setStaffLoading] = useState(false)
    const [inviteLink, setInviteLink] = useState('')
    const [inviteExpiry, setInviteExpiry] = useState(null)
    const [generatingLink, setGeneratingLink] = useState(false)
    const [copied, setCopied] = useState(false)

    // Listen for new orders if manager
    useEffect(() => {
        if (!supabase || isStaff) return

        const ordersChannel = supabase
            .channel('address-orders-realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
                const addressId = payload.new.address_id
                const address = addresses.find(a => a.id === addressId)

                const { data: items } = await supabase.from('order_items').select('quantity, products(count_as_cup)').eq('order_id', payload.new.id)
                let qty = 0
                if (items) qty = items.reduce((s, i) => i.products?.count_as_cup === false ? s : s + i.quantity, 0)

                setRealtimeNotification({
                    title: address ? address.name : 'Đơn mới',
                    description: `Khách vừa mua (${qty} ly)`,
                    total: payload.new.total
                })

                if (addressId) {
                    setCupsMap(prev => ({ ...prev, [addressId]: (prev[addressId] || 0) + qty }))
                }
            })
            .subscribe()

        return () => { supabase.removeChannel(ordersChannel) }
    }, [addresses, isStaff])

    // Background prefetch ProductContext data for all addresses into cache
    useEffect(() => {
        if (!addresses.length) return
        addresses.forEach(async addr => {
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
            } catch { /* ignore prefetch errors */ }
        })
    }, [addresses])

    // Fetch branch stats
    useEffect(() => {
        if (!addresses.length) return
        const addrIds = addresses.map(a => a.id)
        setStatsLoading(true)

        Promise.all([
            fetchBranchTodayCups(addrIds),
            fetchActiveSessions(addrIds)
        ]).then(([cups, sessions]) => {
            setCupsMap(cups)
            const grouped = {}
            sessions.forEach(s => {
                if (!grouped[s.address_id]) grouped[s.address_id] = []
                grouped[s.address_id].push(s.users?.name || 'Unknown')
            })
            setSessionsMap(grouped)
        }).finally(() => setStatsLoading(false))
    }, [addresses])

    // Fetch staff when tab opens
    useEffect(() => {
        if (activeTab !== 'staff' || !profile?.id || isStaff) return
        setStaffLoading(true)
        fetchStaffByManager(profile.id)
            .then(setStaffList)
            .finally(() => setStaffLoading(false))
    }, [activeTab, profile?.id, isStaff])

    function handleSelect(addr) {
        setSelectedAddress(addr)
        navigate('/pos', { replace: true })
    }

    async function handleCreate(e) {
        e.preventDefault()
        if (!newName.trim()) return
        setCreating(true)
        setError('')
        try {
            const addr = await createNewAddress(newName.trim())
            setNewName('')
            setShowForm(false)
            handleSelect(addr)
        } catch (err) {
            setError(err.message || 'Không thể tạo địa chỉ')
        } finally {
            setCreating(false)
        }
    }

    async function handleGenerateInvite() {
        if (!profile?.id) return
        setGeneratingLink(true)
        setInviteLink('')
        try {
            const { token, expires_at } = await createInviteToken(profile.id)
            setInviteLink(`${window.location.origin}/signup/${token}`)
            setInviteExpiry(new Date(expires_at))
        } catch (err) {
            setError(err.message || 'Không thể tạo link')
        } finally {
            setGeneratingLink(false)
        }
    }

    async function handleCopy() {
        await navigator.clipboard.writeText(inviteLink)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    async function handleSignOut() {
        await signOut()
        navigate('/login', { replace: true })
    }

    const today = new Date()
    const dateOnly = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
                <div className="w-full max-w-sm space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <Skeleton className="h-24 rounded-[20px]" />
                        <Skeleton className="h-24 rounded-[20px]" />
                    </div>
                    <Skeleton className="h-16 w-full rounded-[16px]" />
                    <Skeleton className="h-16 w-full rounded-[16px]" />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4 py-8">
            <div className="w-full max-w-sm">

                {/* ── Header = Tab Switcher ── */}
                {!isStaff ? (
                    <div className="grid grid-cols-2 gap-3 mb-5">
                        {/* Card trái: user + Cơ sở tab */}
                        <button
                            onClick={() => { setActiveTab('branches'); setError('') }}
                            className={`rounded-[20px] p-4 border text-left flex flex-col justify-between gap-2 relative overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${activeTab === 'branches'
                                ? 'bg-primary/5 border-primary/20 shadow-[0_4px_20px_rgba(245,158,11,0.08)]'
                                : 'bg-surface border-border/60 hover:bg-surface-light'}`}
                        >
                            <div className="relative z-10">
                                <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Xin chào</p>
                                <p className={`text-[15px] font-black leading-tight mt-0.5 ${activeTab === 'branches' ? 'text-primary' : 'text-text'}`}>
                                    {profile?.name || '...'}
                                </p>
                            </div>
                            <div className={`w-full h-[1px] rounded-full ${activeTab === 'branches' ? 'bg-primary/20' : 'bg-border/60'}`} />
                            <div className="flex items-center gap-1.5 relative z-10">
                                <Building2 size={13} className={activeTab === 'branches' ? 'text-primary' : 'text-text-secondary'} />
                                <span className={`text-xs font-black uppercase tracking-wider ${activeTab === 'branches' ? 'text-primary' : 'text-text-secondary'}`}>
                                    Cơ sở
                                </span>
                            </div>
                            {activeTab === 'branches' && (
                                <div className="absolute bottom-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-8 -mb-8 pointer-events-none" />
                            )}
                        </button>

                        {/* Card phải: ngày + Nhân viên tab */}
                        <button
                            onClick={() => { setActiveTab('staff'); setError('') }}
                            className={`rounded-[20px] p-4 border text-left flex flex-col justify-between gap-2 relative overflow-hidden transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${activeTab === 'staff'
                                ? 'bg-primary/5 border-primary/20 shadow-[0_4px_20px_rgba(245,158,11,0.08)]'
                                : 'bg-surface border-border/60 hover:bg-surface-light'}`}
                        >
                            <div className="relative z-10">
                                <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Hôm nay</p>
                                <p className={`text-[15px] font-black leading-tight mt-0.5 ${activeTab === 'staff' ? 'text-primary' : 'text-text'}`}>
                                    {dateOnly}
                                </p>
                            </div>
                            <div className={`w-full h-[1px] rounded-full ${activeTab === 'staff' ? 'bg-primary/20' : 'bg-border/60'}`} />
                            <div className="flex items-center gap-1.5 relative z-10">
                                <Users size={13} className={activeTab === 'staff' ? 'text-primary' : 'text-text-secondary'} />
                                <span className={`text-xs font-black uppercase tracking-wider ${activeTab === 'staff' ? 'text-primary' : 'text-text-secondary'}`}>
                                    Nhân viên
                                </span>
                            </div>
                            {activeTab === 'staff' && (
                                <div className="absolute bottom-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-8 -mb-8 pointer-events-none" />
                            )}
                        </button>
                    </div>
                ) : (
                    /* Staff: simple header, no tab */
                    <div className="mb-5 bg-surface border border-border/60 rounded-[20px] p-4">
                        <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Xin chào</p>
                        <p className="text-[15px] font-black text-text mt-0.5">{profile?.name || '...'}</p>
                        <div className="w-full h-[1px] bg-border/60 rounded-full my-2" />
                        <div className="flex items-center gap-1.5">
                            <Building2 size={13} className="text-text-secondary" />
                            <span className="text-xs font-black text-text-secondary uppercase tracking-wider">Chọn địa chỉ</span>
                        </div>
                    </div>
                )}

                {/* ── BRANCHES TAB ── */}
                {(activeTab === 'branches' || isStaff) && (
                    <>
                        <div className="space-y-2.5 mb-4">
                            {addresses.length === 0 && !showForm && (
                                <div className="bg-surface border border-border/60 rounded-[20px] p-6 text-center">
                                    <Coffee size={24} className="text-text-secondary mx-auto mb-2" />
                                    <p className="text-text-secondary text-sm">Chưa có địa chỉ nào. Tạo địa chỉ mới để bắt đầu!</p>
                                </div>
                            )}

                            {addresses.map(addr => {
                                const cups = cupsMap[addr.id] || 0
                                const staffNames = sessionsMap[addr.id] || []
                                const isEditing = editingAddressId === addr.id

                                return (
                                    <div
                                        key={addr.id}
                                        className="w-full bg-surface border border-border/60 rounded-[20px] overflow-hidden shadow-sm group hover:border-border/80 hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] transition-all"
                                    >
                                        {isEditing ? (
                                            <form
                                                className="flex w-full px-3 py-3 gap-2"
                                                onSubmit={async (e) => {
                                                    e.preventDefault()
                                                    if (!editName.trim()) return
                                                    try {
                                                        await renameAddress(addr.id, editName.trim())
                                                        setEditingAddressId(null)
                                                    } catch (err) {
                                                        setError(err.message || 'Không thể đổi tên')
                                                    }
                                                }}
                                            >
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    className="flex-1 px-3 py-2 rounded-[12px] bg-bg border border-border/60 text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                                                    autoFocus
                                                />
                                                <button type="submit" className="px-3 py-2 bg-primary text-black text-xs font-black rounded-[12px]">Lưu</button>
                                                <button type="button" onClick={() => { setEditingAddressId(null); setError('') }} className="px-3 py-2 bg-bg border border-border/60 text-text-secondary text-xs font-bold rounded-[12px]">Hủy</button>
                                            </form>
                                        ) : (
                                            <div className="flex items-stretch">
                                                {/* Main click area */}
                                                <button
                                                    onClick={() => handleSelect(addr)}
                                                    className="flex-1 px-5 py-4 text-left hover:bg-surface-light active:bg-border/30 transition-colors min-w-0"
                                                >
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <span className="text-text font-black text-sm group-hover:text-primary transition-colors truncate">{addr.name}</span>
                                                        <ChevronRight size={14} className="text-text-secondary shrink-0 group-hover:text-primary transition-colors" />
                                                    </div>
                                                    {!statsLoading && (
                                                        <div className="flex items-center gap-3">
                                                            <span className="flex items-center gap-1 text-text-secondary text-xs">
                                                                <Coffee size={11} />
                                                                <span>{cups} ly</span>
                                                            </span>
                                                            {staffNames.length > 0 && (
                                                                <span className="flex items-center gap-1 text-success text-xs">
                                                                    <UserCircle2 size={11} />
                                                                    <span>{staffNames.join(', ')}</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </button>

                                                {/* Action buttons */}
                                                {!isStaff && (
                                                    <div className="flex items-center shrink-0 pr-2 gap-0.5">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setBackupSource(addr) }}
                                                            className="p-2 text-text-secondary hover:text-primary transition-colors rounded-xl hover:bg-primary/10"
                                                            title="Sao lưu cấu hình"
                                                        >
                                                            <ClipboardCopy size={15} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setEditingAddressId(addr.id)
                                                                setEditName(addr.name)
                                                                setDeletingAddressId(null)
                                                                setError('')
                                                            }}
                                                            className="p-2 text-text-secondary hover:text-primary transition-colors rounded-xl hover:bg-surface-light"
                                                            title="Đổi tên"
                                                        >
                                                            <Pencil size={15} />
                                                        </button>
                                                        {deletingAddressId === addr.id ? (
                                                            <>
                                                                <button
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation()
                                                                        try {
                                                                            await removeAddress(addr.id)
                                                                        } catch (err) {
                                                                            setError(err.message || 'Không thể xóa địa chỉ')
                                                                        } finally {
                                                                            setDeletingAddressId(null)
                                                                        }
                                                                    }}
                                                                    className="px-2.5 py-1.5 bg-danger text-white text-xs font-black rounded-[10px] hover:bg-danger/90 transition-colors"
                                                                >
                                                                    Xóa
                                                                </button>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setDeletingAddressId(null) }}
                                                                    className="px-2.5 py-1.5 bg-bg border border-border/60 text-text-secondary text-xs font-bold rounded-[10px] hover:bg-surface-light transition-colors"
                                                                >
                                                                    Hủy
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setDeletingAddressId(addr.id) }}
                                                                className="p-2 text-text-secondary hover:text-danger transition-colors rounded-xl hover:bg-danger/10"
                                                                title="Xóa"
                                                            >
                                                                <Trash2 size={15} />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        <ErrorBanner message={error} small className="mb-3" />

                        {isAdmin && (
                            <button
                                onClick={() => {
                                    setSelectedAddress({ id: null, name: 'Mẫu mặc định' })
                                    navigate('/recipes')
                                }}
                                className="w-full py-3 rounded-[16px] bg-surface border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors mb-2"
                            >
                                Mẫu mặc định
                            </button>
                        )}

                        {!isStaff && (
                            showForm ? (
                                <form onSubmit={handleCreate} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm space-y-3">
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={e => setNewName(e.target.value)}
                                        placeholder="Tên địa chỉ mới (vd: Quán Cầu Giấy)"
                                        autoFocus
                                        className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { setShowForm(false); setNewName(''); setError('') }}
                                            className="flex-1 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text-secondary font-bold text-xs hover:bg-border/30 transition-colors"
                                        >
                                            Hủy
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={creating || !newName.trim()}
                                            className="flex-1 py-2.5 rounded-[12px] bg-primary text-black font-black text-xs hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                                        >
                                            {creating ? <><Loader size={13} className="animate-spin" /> Đang tạo...</> : 'Tạo'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <button
                                    onClick={() => setShowForm(true)}
                                    className="w-full py-3 rounded-[16px] bg-primary/10 border border-primary/20 text-primary font-black text-sm hover:bg-primary/15 active:bg-primary/20 transition-colors flex items-center justify-center gap-2"
                                >
                                    <Plus size={16} />
                                    Thêm địa chỉ
                                </button>
                            )
                        )}
                    </>
                )}

                {/* ── STAFF TAB ── */}
                {activeTab === 'staff' && !isStaff && (
                    <div className="space-y-3">
                        {/* Staff list */}
                        <div className="bg-surface border border-border/60 rounded-[20px] overflow-hidden">
                            <div className="px-4 py-3 border-b border-border/40">
                                <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Danh sách nhân viên</p>
                            </div>
                            {staffLoading ? (
                                <div className="p-4 space-y-2">
                                    <Skeleton className="h-10 rounded-[10px]" />
                                    <Skeleton className="h-10 rounded-[10px]" />
                                </div>
                            ) : staffList.length === 0 ? (
                                <div className="px-4 py-6 text-center">
                                    <Users size={20} className="text-text-secondary mx-auto mb-2" />
                                    <p className="text-text-secondary text-sm">Chưa có nhân viên nào</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-border/40">
                                    {staffList.map(staff => (
                                        <div key={staff.id} className="px-4 py-3 flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                <span className="text-primary text-xs font-black">{staff.name.charAt(0).toUpperCase()}</span>
                                            </div>
                                            <span className="text-text text-sm font-medium">{staff.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Invite section */}
                        <div className="bg-surface border border-border/60 rounded-[20px] p-4 space-y-3">
                            <p className="text-[11px] font-black text-text-secondary uppercase tracking-wider">Mời nhân viên mới</p>
                            <button
                                onClick={handleGenerateInvite}
                                disabled={generatingLink}
                                className="w-full py-3 rounded-[14px] bg-primary/10 border border-primary/20 text-primary font-black text-sm hover:bg-primary/15 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {generatingLink ? <><Loader size={14} className="animate-spin" /> Đang tạo...</> : 'Tạo link mời'}
                            </button>

                            {inviteLink && (
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <input
                                            readOnly
                                            value={inviteLink}
                                            className="flex-1 min-w-0 px-3 py-2 rounded-[10px] bg-bg border border-border/60 text-text-secondary text-xs font-medium focus:outline-none truncate"
                                        />
                                        <button
                                            onClick={handleCopy}
                                            className="px-3 py-2 bg-primary text-black text-xs font-black rounded-[10px] shrink-0 hover:bg-primary/90 transition-colors flex items-center gap-1.5"
                                        >
                                            {copied ? <><Check size={13} /> Đã sao chép</> : <><Copy size={13} /> Sao chép</>}
                                        </button>
                                    </div>
                                    {inviteExpiry && (
                                        <p className="text-text-secondary text-xs text-center">
                                            Hết hạn: {inviteExpiry.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                        </p>
                                    )}
                                </div>
                            )}

                            <ErrorBanner message={error} small />
                        </div>


                    </div>
                )}

                {/* Sign out */}
                <button
                    onClick={handleSignOut}
                    className="flex items-center justify-center gap-2 w-full mt-4 py-2.5 text-text-secondary text-xs font-bold hover:text-danger transition-colors"
                >
                    <LogOut size={13} />
                    Đăng xuất
                </button>
            </div>

            {/* Backup Modal */}
            {backupSource && (
                <BackupModal
                    sourceAddress={backupSource}
                    addresses={addresses}
                    onClose={() => setBackupSource(null)}
                />
            )}

            <RealtimeNotification
                notification={realtimeNotification}
                onClose={() => setRealtimeNotification(null)}
            />
        </div>
    )
}
