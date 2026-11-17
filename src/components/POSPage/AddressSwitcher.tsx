import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronDown, MapPin, Search } from 'lucide-react'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useAddressStats } from '../../contexts/AddressStatsContext'
import { useCart } from '../../contexts/CartContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useMonetizationEnabled } from '../../hooks/useEntitlement'
import { computeAccessGate } from '../../utils/subscriptionStatus'
import { BottomSheet, SheetHeader, SHEET_PANEL } from '../common/ModalShell'
import type { Address } from '../../types/domain'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase()

// Ô địa chỉ trên thanh POS: chạm → danh sách địa chỉ, chọn là đổi ngay không qua /addresses.
// Đổi địa chỉ = POSProvider remount (RequireAddress key theo id) nên giỏ hàng đang dựng sẽ mất → hỏi trước.
export default function AddressSwitcher() {
    const { isGuest } = useAuth()
    const { addresses, selectedAddress, setSelectedAddress } = useAddress()
    const { revenueMap, subscriptionRowsMap } = useAddressStats()
    const { enabled: monetization, loading: flagLoading } = useMonetizationEnabled()
    const { cart } = useCart()
    const confirm = useConfirm()
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')

    // Cùng thứ tự với /addresses: doanh thu hôm nay giảm dần.
    const sorted = useMemo(() => [...addresses].sort((a, b) => (revenueMap[b.id] || 0) - (revenueMap[a.id] || 0)), [addresses, revenueMap])
    const shown = q.trim() ? sorted.filter(a => fold(a.name).includes(fold(q.trim()))) : sorted

    async function pick(addr: Address) {
        if (addr.id === selectedAddress?.id) { setOpen(false); return }
        if (cart.length > 0 && !(await confirm({ title: `Đổi sang ${addr.name}?`, detail: 'Đơn đang chọn dở sẽ bị xoá.', confirmLabel: 'Đổi địa chỉ', danger: true }))) return
        setOpen(false)
        // Cùng cổng gói như /addresses (enter): sắp/đã hết hạn → trang gói của địa chỉ đó.
        const gate = !(monetization || flagLoading) ? 'ok' : computeAccessGate(subscriptionRowsMap[addr.id])
        if (gate === 'ok') setSelectedAddress(addr)
        else navigate('/subscription', { state: { preselectAddressId: addr.id, from: '/pos', locked: gate === 'hard', skipTo: '/pos' } })
    }

    return (
        <>
            <button
                type="button"
                onClick={addresses.length > 1 ? () => { setQ(''); setOpen(true) } : () => navigate(isGuest ? '/login' : '/addresses')}
                className="min-w-0 flex-1 h-11 pl-2.5 pr-3.5 flex items-center gap-2 rounded-full bg-bg border border-border/60 active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
                <span className="shrink-0 w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center"><MapPin size={15} className="text-primary" /></span>
                <span className="flex-1 min-w-0 truncate text-left text-[13px] font-black uppercase tracking-wide text-success">{selectedAddress?.name}</span>
                <ChevronDown size={14} strokeWidth={3} className="shrink-0 text-text-secondary" />
            </button>
            {open && (
                <BottomSheet onClose={() => setOpen(false)} panelClassName={`${SHEET_PANEL} max-h-[80dvh]`}>
                    <SheetHeader title="Đổi địa chỉ" onClose={() => setOpen(false)} />
                    {addresses.length > 6 && (
                        <label className="flex items-center gap-2 h-10 px-3 rounded-[14px] bg-bg border border-border/60">
                            <Search size={15} className="shrink-0 text-text-secondary" />
                            <input
                                autoFocus
                                value={q}
                                onChange={e => setQ(e.target.value)}
                                placeholder="Tìm địa chỉ"
                                className="flex-1 min-w-0 bg-transparent text-[14px] font-bold text-text placeholder:text-text-dim focus:outline-none"
                            />
                        </label>
                    )}
                    <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 flex flex-col gap-1.5">
                        {shown.map(a => (
                            <button
                                key={a.id}
                                type="button"
                                onClick={() => pick(a)}
                                className={`flex items-center gap-2 px-3 py-3 rounded-[14px] border text-left active:scale-[0.99] transition-all ${a.id === selectedAddress?.id ? 'bg-success/10 border-success/40' : 'bg-bg border-border/60'}`}
                            >
                                <span className="flex-1 min-w-0 truncate text-[14px] font-black uppercase tracking-wide text-text">{a.name}</span>
                                {a.id === selectedAddress?.id && <Check size={16} strokeWidth={3} className="shrink-0 text-success" />}
                            </button>
                        ))}
                        {shown.length === 0 && <span className="py-6 text-center text-[13px] font-bold text-text-secondary">Không có địa chỉ nào khớp</span>}
                    </div>
                </BottomSheet>
            )}
        </>
    )
}
