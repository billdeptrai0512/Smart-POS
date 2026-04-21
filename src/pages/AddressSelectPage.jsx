import { useState, useEffect } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { fetchBranchTodayCups, fetchActiveSessions, fetchStaffByManager, createInviteToken } from '../services/authService'
import { supabase } from '../lib/supabaseClient'
import RealtimeNotification from '../components/POSPage/RealtimeNotification'

export default function AddressSelectPage() {
    const { addresses, setSelectedAddress, createNewAddress, renameAddress, removeAddress, loading } = useAddress()
    const { signOut, profile, isStaff } = useAuth()
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

                const { data: items } = await supabase.from('order_items').select('quantity').eq('order_id', payload.new.id)
                let qty = 0
                if (items) qty = items.reduce((s, i) => s + i.quantity, 0)

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

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
                <div className="w-full max-w-sm space-y-3">
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-16 w-full" />
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-16 w-full" />
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-10 w-1/2 mx-auto mt-4" />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-5">
                    <h1 className="text-xl font-black text-text">
                        {activeTab === 'branches' ? 'Chọn địa chỉ' : 'Nhân viên'}
                    </h1>
                    {profile && (
                        <p className="text-text-secondary text-sm mt-1">
                            Xin chào, <span className="font-bold text-text">{profile.name}</span>
                        </p>
                    )}
                </div>

                {/* Tab switcher — manager only */}
                {!isStaff && (
                    <div className="flex gap-2 mb-4 bg-surface border border-border/60 rounded-[14px] p-1">
                        <button
                            onClick={() => { setActiveTab('branches'); setError('') }}
                            className={`flex-1 py-2 rounded-[10px] text-xs font-bold transition-colors ${activeTab === 'branches'
                                ? 'bg-primary text-white'
                                : 'text-text-secondary hover:text-text'
                            }`}
                        >
                            Cơ sở
                        </button>
                        <button
                            onClick={() => { setActiveTab('staff'); setError('') }}
                            className={`flex-1 py-2 rounded-[10px] text-xs font-bold transition-colors ${activeTab === 'staff'
                                ? 'bg-primary text-white'
                                : 'text-text-secondary hover:text-text'
                            }`}
                        >
                            Nhân viên
                        </button>
                    </div>
                )}

                {/* ── BRANCHES TAB ── */}
                {activeTab === 'branches' && (
                    <>
                        <div className="space-y-3 mb-4">
                            {addresses.length === 0 && !showForm && (
                                <div className="bg-surface border border-border/60 rounded-[16px] p-5 text-center text-text-secondary text-sm">
                                    Chưa có địa chỉ nào. Tạo địa chỉ mới để bắt đầu!
                                </div>
                            )}

                            {addresses.map(addr => {
                                const cups = cupsMap[addr.id] || 0
                                const staffNames = sessionsMap[addr.id] || []

                                return (
                                    <div key={addr.id} className="w-full bg-surface border border-border/60 rounded-[16px] overflow-hidden shadow-sm group">
                                        {editingAddressId === addr.id ? (
                                            <form
                                                className="flex w-full px-2 py-2 gap-2"
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
                                                    className="flex-1 px-3 py-2 rounded-[10px] bg-bg border border-border/60 text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                                                    autoFocus
                                                />
                                                <button type="submit" className="px-3 py-2 bg-primary text-white text-xs font-bold rounded-[10px]">Lưu</button>
                                                <button type="button" onClick={() => { setEditingAddressId(null); setError('') }} className="px-3 py-2 bg-bg border border-border/60 text-text-secondary text-xs font-bold rounded-[10px]">Hủy</button>
                                            </form>
                                        ) : (
                                            <div className="flex items-center">
                                                <button
                                                    onClick={() => handleSelect(addr)}
                                                    className="flex-1 px-5 py-3 text-left hover:bg-surface-light active:bg-border/30 transition-colors"
                                                >
                                                    <span className="text-text font-bold text-sm group-hover:text-primary transition-colors block">{addr.name}</span>
                                                    {!statsLoading && (
                                                        <span className="text-text-secondary text-xs mt-1 flex items-center gap-3">
                                                            <span>☕ {cups} ly</span>
                                                            {staffNames.length > 0 && (
                                                                <span>👤 {staffNames.join(', ')}</span>
                                                            )}
                                                        </span>
                                                    )}
                                                </button>
                                                {!isStaff && (
                                                    <div className="flex flex-shrink-0 px-2 space-x-1">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                setEditingAddressId(addr.id)
                                                                setEditName(addr.name)
                                                                setError('')
                                                            }}
                                                            className="p-2 text-text-secondary hover:text-primary transition-colors"
                                                            title="Đổi tên"
                                                        >
                                                            ✏️
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation()
                                                                if (window.confirm(`Bạn có chắc muốn xóa địa chỉ "${addr.name}"?`)) {
                                                                    try {
                                                                        await removeAddress(addr.id)
                                                                    } catch (err) {
                                                                        setError(err.message || 'Không thể xóa địa chỉ')
                                                                    }
                                                                }
                                                            }}
                                                            className="p-2 text-text-secondary hover:text-danger transition-colors"
                                                            title="Xóa"
                                                        >
                                                            🗑️
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        {error && (
                            <div className="bg-danger/10 border border-danger/20 text-danger text-xs font-medium rounded-[10px] p-2 mb-3">
                                {error}
                            </div>
                        )}

                        {!isStaff && (
                            showForm ? (
                                <form onSubmit={handleCreate} className="bg-surface border border-border/60 rounded-[16px] p-4 shadow-sm space-y-3">
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
                                            className="flex-1 py-2.5 rounded-[12px] bg-primary text-white font-bold text-xs hover:bg-primary/90 transition-colors disabled:opacity-50"
                                        >
                                            {creating ? 'Đang tạo...' : 'Tạo'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <button
                                    onClick={() => setShowForm(true)}
                                    className="w-full py-3 rounded-[14px] bg-primary/10 border border-primary/20 text-primary font-bold text-sm hover:bg-primary/15 active:bg-primary/20 transition-colors"
                                >
                                    +
                                </button>
                            )
                        )}
                    </>
                )}

                {/* ── STAFF TAB ── */}
                {activeTab === 'staff' && (
                    <div className="space-y-4">
                        {/* Invite section */}
                        <div className="bg-surface border border-border/60 rounded-[16px] p-4 space-y-3">
                            <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Mời nhân viên mới</p>
                            <button
                                onClick={handleGenerateInvite}
                                disabled={generatingLink}
                                className="w-full py-2.5 rounded-[12px] bg-primary/10 border border-primary/20 text-primary font-bold text-sm hover:bg-primary/15 transition-colors disabled:opacity-50"
                            >
                                {generatingLink ? 'Đang tạo...' : 'Tạo link mời'}
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
                                            className="px-3 py-2 bg-primary text-white text-xs font-bold rounded-[10px] shrink-0 hover:bg-primary/90 transition-colors"
                                        >
                                            {copied ? 'Đã sao chép!' : 'Sao chép'}
                                        </button>
                                    </div>
                                    {inviteExpiry && (
                                        <p className="text-text-secondary text-xs text-center">
                                            Hết hạn: {inviteExpiry.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                        </p>
                                    )}
                                </div>
                            )}

                            {error && (
                                <div className="bg-danger/10 border border-danger/20 text-danger text-xs font-medium rounded-[10px] p-2">
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* Staff list */}
                        <div className="bg-surface border border-border/60 rounded-[16px] overflow-hidden">
                            <div className="px-4 py-3 border-b border-border/60">
                                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Danh sách nhân viên</p>
                            </div>
                            {staffLoading ? (
                                <div className="p-4 space-y-2">
                                    <div className="animate-pulse bg-surface-light rounded-[10px] h-10 w-full" />
                                    <div className="animate-pulse bg-surface-light rounded-[10px] h-10 w-full" />
                                </div>
                            ) : staffList.length === 0 ? (
                                <div className="px-4 py-6 text-center text-text-secondary text-sm">
                                    Chưa có nhân viên nào
                                </div>
                            ) : (
                                <div className="divide-y divide-border/40">
                                    {staffList.map(staff => (
                                        <div key={staff.id} className="px-4 py-3 flex items-center gap-3">
                                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                <span className="text-primary text-xs font-bold">{staff.name.charAt(0).toUpperCase()}</span>
                                            </div>
                                            <span className="text-text text-sm font-medium">{staff.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <button
                    onClick={handleSignOut}
                    className="w-full mt-4 py-2.5 rounded-[14px] text-text-secondary text-xs font-bold hover:text-danger transition-colors"
                >
                    Đăng xuất
                </button>
            </div>

            <RealtimeNotification
                notification={realtimeNotification}
                onClose={() => setRealtimeNotification(null)}
            />
        </div>
    )
}
