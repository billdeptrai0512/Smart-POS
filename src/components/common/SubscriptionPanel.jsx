import { useState } from 'react'
import { Check, QrCode, Loader2, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { supabase } from '../../lib/supabaseClient'
import { usePaymentListener } from '../../hooks/usePaymentListener'
import { formatVND } from '../../utils'
import {
    MODULE_KEYS, MODULE_META, PRICE, PERIOD_LABEL, PERIOD_MONTHS,
} from '../../constants/monetization'

// Gradient vàng thương hiệu (đồng bộ badge "developed by").
const GOLD = 'linear-gradient(135deg, #f8c577, #f59e0b, #d4882f, #b8732a)'

/**
 * SubscriptionPanel — thân trang đăng ký gói (checkout cao cấp).
 * Period là controlled prop (tabs ở SubscriptionScreen). Xem MONETIZATION.md §6.
 *
 * Props: period, preselectModule, preselectAddressId, onDone
 */
export default function SubscriptionPanel({ period = 'month', preselectModule, preselectAddressId, onDone }) {
    const { isAdmin } = useAuth()
    const { addresses, selectedAddress } = useAddress()

    const initialAddressId = preselectAddressId || selectedAddress?.id

    const [selectedAddressIds, setSelectedAddressIds] = useState(() => {
        if (initialAddressId) return [initialAddressId]
        return addresses.length ? [addresses[0].id] : []
    })
    const [selectedModules, setSelectedModules] = useState(() =>
        preselectModule ? [preselectModule] : [...MODULE_KEYS]
    )
    const [isMocking, setIsMocking] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [branchQuery, setBranchQuery] = useState('')

    // Realtime listener: webhook SePay → Edge Function → INSERT address_subscriptions
    // → đẩy về đây → tự xác nhận + mở khoá. Theo dõi mọi chi nhánh của owner.
    usePaymentListener({
        addressIds: addresses.map(a => a.id),
        enabled: !confirmed,
        onConfirmed: () => {
            setConfirmed(true)
            setTimeout(() => { onDone ? onDone() : window.location.reload() }, 1600)
        },
    })

    const toggleAddress = (id) => setSelectedAddressIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    const toggleModule = (key) => setSelectedModules(prev =>
        prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
    )
    const allAddressesSelected = addresses.length > 0 && selectedAddressIds.length === addresses.length
    const toggleAllAddresses = () =>
        setSelectedAddressIds(allAddressesSelected ? [] : addresses.map(a => a.id))

    // Nhiều chi nhánh → bật search + cuộn nội bộ (xem MONETIZATION.md, hỏi UI >25 CN).
    const manyBranches = addresses.length > 6
    const filteredAddresses = branchQuery.trim()
        ? addresses.filter(a => normalizeText(a.name).includes(normalizeText(branchQuery)))
        : addresses

    // ── Tính tiền ────────────────────────────────────────────────────────────────
    const moduleCount = selectedModules.length
    const addrCount = selectedAddressIds.length
    const isBundle = moduleCount === MODULE_KEYS.length   // chọn đủ cả 2 → giá bundle
    const perAddress = isBundle ? PRICE.bundle[period] : PRICE.module[period] * moduleCount
    const originalPerAddress = PRICE.module[period] * moduleCount        // giá nếu mua lẻ
    const total = perAddress * addrCount
    const originalTotal = originalPerAddress * addrCount
    const savings = originalTotal - total
    const canSubmit = moduleCount > 0 && addrCount > 0

    const handleMockPayment = async () => {
        if (!canSubmit) return
        setIsMocking(true)
        try {
            const today = new Date()
            const validTo = new Date(today)
            validTo.setMonth(validTo.getMonth() + PERIOD_MONTHS[period])
            const iso = (d) => d.toISOString().split('T')[0]
            const amountPer = isBundle ? Math.round(perAddress / moduleCount) : PRICE.module[period]

            const rows = selectedAddressIds.flatMap(addressId =>
                selectedModules.map(tier => ({
                    address_id: addressId,
                    tier,
                    valid_from: iso(today),
                    valid_to: iso(validTo),
                    months: PERIOD_MONTHS[period],
                    amount_paid: amountPer,
                    note: 'admin_mock',
                }))
            )

            const { error } = await supabase.from('address_subscriptions').insert(rows)
            if (error) throw error
            if (onDone) onDone()
            else window.location.reload()
        } catch (err) {
            alert('Lỗi: ' + err.message)
            setIsMocking(false)
        }
    }

    return (
        <div className="flex flex-col gap-5 animate-fade-in">
            {/* ── 1. Chọn báo cáo — 2 cột, không cần label ───────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
                {MODULE_KEYS.map((key, i) => {
                    const m = MODULE_META[key]
                    const Icon = m.icon
                    const active = selectedModules.includes(key)
                    return (
                        <button
                            key={key}
                            onClick={() => toggleModule(key)}
                            style={{ animationDelay: `${i * 40}ms` }}
                            className={`relative flex flex-col items-center text-center gap-1.5 rounded-[16px] border px-2 py-3 transition-all duration-200 animate-scale-up
                                ${active
                                    ? 'border-primary/70 bg-primary/[0.06] shadow-[0_0_20px_rgba(245,158,11,0.10)]'
                                    : 'border-border/60 bg-surface-light hover:border-border-light'}`}
                        >
                            {/* Check nhỏ góc khi chọn */}
                            <span className={`absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center transition-all
                                ${active ? 'bg-primary' : 'border border-border-light'}`}>
                                {active && <Check size={10} className="text-bg" strokeWidth={4} />}
                            </span>

                            <span
                                className={`w-10 h-10 rounded-[13px] flex items-center justify-center transition-all
                                    ${active ? 'shadow-[0_0_14px_rgba(245,158,11,0.25)]' : ''}`}
                                style={{ background: active ? GOLD : 'rgba(245,158,11,0.10)' }}
                            >
                                <Icon size={18} className={active ? 'text-bg' : 'text-primary'} strokeWidth={2.3} />
                            </span>

                            <span className="text-[12.5px] font-black text-text leading-tight">{m.label}</span>
                            <span className="text-[10.5px] font-bold text-primary tabular-nums">{formatVND(PRICE.module[period])}</span>
                        </button>
                    )
                })}
            </div>

            {/* ── 2. Chi nhánh (áp dụng ở đâu) ────────────────────────────────────── */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader
                    title="Chi nhánh"
                    hint={addresses.length > 0 ? `${addrCount}/${addresses.length}` : undefined}
                    action={addresses.length > 1 && (
                        <button onClick={toggleAllAddresses} className="text-[11px] font-black text-primary uppercase tracking-wide whitespace-nowrap">
                            {allAddressesSelected ? 'Bỏ tất cả' : 'Tất cả'}
                        </button>
                    )}
                />

                {/* Search — chỉ khi nhiều chi nhánh */}
                {manyBranches && (
                    <input
                        type="text"
                        value={branchQuery}
                        onChange={e => setBranchQuery(e.target.value)}
                        placeholder="Tìm chi nhánh…"
                        className="w-full px-3 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text text-[13px] placeholder:text-text-dim focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    />
                )}

                <div className={`flex flex-col gap-1.5 ${manyBranches ? 'max-h-[240px] overflow-y-auto pr-0.5' : ''}`}>
                    {filteredAddresses.map(addr => {
                        const active = selectedAddressIds.includes(addr.id)
                        return (
                            <button
                                key={addr.id}
                                onClick={() => toggleAddress(addr.id)}
                                className={`w-full text-left rounded-[12px] border px-3 py-2 transition-all duration-150
                                    ${active
                                        ? 'border-primary bg-primary/[0.07] shadow-[0_0_14px_rgba(245,158,11,0.12)]'
                                        : 'border-border/60 bg-surface-light hover:border-border-light'}`}
                            >
                                <span className={`block min-w-0 text-[13px] font-bold truncate transition-colors ${active ? 'text-text' : 'text-text-secondary'}`}>
                                    {addr.name}
                                </span>
                            </button>
                        )
                    })}
                    {filteredAddresses.length === 0 && (
                        <p className="text-[12px] text-text-secondary py-2">
                            {addresses.length === 0 ? 'Chưa có chi nhánh nào.' : 'Không tìm thấy chi nhánh.'}
                        </p>
                    )}
                </div>
            </section>

            {/* ── 3. Thanh toán — 1 card gắn kết: QR + tổng cộng + status ────────── */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader title="Thanh toán" />
                <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3.5">
                    <div className="flex items-center gap-3.5">
                        {/* QR trái */}
                        <div className={`relative w-[96px] aspect-square shrink-0 rounded-[14px] border flex items-center justify-center overflow-hidden transition-colors
                            ${confirmed ? 'bg-success-soft/60 border-success/40 text-success' : 'bg-surface-light border-border/60 text-text-dim'}`}>
                            <Corner className="top-2 left-2 border-t-2 border-l-2 rounded-tl-[6px]" />
                            <Corner className="top-2 right-2 border-t-2 border-r-2 rounded-tr-[6px]" />
                            <Corner className="bottom-2 left-2 border-b-2 border-l-2 rounded-bl-[6px]" />
                            <Corner className="bottom-2 right-2 border-b-2 border-r-2 rounded-br-[6px]" />
                            {confirmed
                                ? <CheckCircle2 size={34} strokeWidth={1.8} className="animate-scale-up" />
                                : <QrCode size={34} strokeWidth={1.5} />}
                        </div>

                        {/* Tổng cộng — căn trái, phân tầng rõ */}
                        <div className="flex-1 min-w-0 flex flex-col items-start text-left">
                            <p className="text-[9.5px] font-black uppercase tracking-[0.12em] text-text-secondary">Tổng cộng</p>
                            <p className="text-[16px] font-black leading-none mt-1 mb-2 bg-clip-text text-transparent" style={{ backgroundImage: GOLD }}>
                                {formatVND(total)}
                            </p>
                            <div className="text-[11px] text-text-secondary tabular-nums leading-[1.45]">
                                <p>1 {PERIOD_LABEL[period]}</p>
                                <p>{moduleCount} báo cáo</p>
                                <p>{addrCount} chi nhánh</p>
                            </div>
                            {savings > 0 && (
                                <span className="mt-1.5 text-[11px] font-bold text-success tabular-nums whitespace-nowrap">
                                    Tiết kiệm {formatVND(savings)}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* status — cùng card, ngăn bằng hairline */}
                    <div className={`flex items-center gap-1.5 mt-3 pt-3 border-t border-border/40 text-[10.5px] ${confirmed ? 'text-success font-bold' : 'text-text-secondary'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full bg-success shrink-0 ${confirmed ? '' : 'animate-pulse'}`} />
                        {confirmed ? 'Đã nhận thanh toán — đang mở khoá…' : 'Đang chờ xác nhận chuyển khoản tự động…'}
                    </div>
                </div>
            </section>

            {/* ── Footer dính đáy: chỉ nút Mock (Admin). User thường xác nhận qua webhook. ── */}
            {isAdmin && (
                <div className="sticky bottom-0 -mx-4 px-4 pt-3 bg-bg/85 backdrop-blur-md border-t border-border/50 pb-[max(env(safe-area-inset-bottom),12px)]">
                    <button
                        onClick={handleMockPayment}
                        disabled={isMocking || !canSubmit}
                        className="w-full py-2.5 rounded-[12px] bg-red-500/10 text-red-500 text-[12px] font-bold hover:bg-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isMocking ? <Loader2 size={14} className="animate-spin" /> : 'Mock mở khoá (Admin)'}
                    </button>
                </div>
            )}
        </div>
    )
}

function SectionHeader({ title, hint, action }) {
    return (
        <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-1 h-3.5 rounded-full bg-primary/70 shrink-0" />
                <p className="text-[12px] font-black text-text uppercase tracking-wider whitespace-nowrap">{title}</p>
                {hint && <span className="text-[10px] text-text-dim normal-case font-medium tracking-normal truncate">{hint}</span>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}

function Corner({ className }) {
    return <span className={`absolute w-4 h-4 border-primary/40 ${className}`} />
}

// Chuẩn hoá để search không phân biệt hoa/thường & dấu tiếng Việt.
function normalizeText(s = '') {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}
