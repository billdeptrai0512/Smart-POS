import { useState } from 'react'
import { Check, QrCode, Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { supabase } from '../../lib/supabaseClient'
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

    const toggleAddress = (id) => setSelectedAddressIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    const toggleModule = (key) => setSelectedModules(prev =>
        prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]
    )
    const allAddressesSelected = addresses.length > 0 && selectedAddressIds.length === addresses.length
    const toggleAllAddresses = () =>
        setSelectedAddressIds(allAddressesSelected ? [] : addresses.map(a => a.id))

    // ── Tính tiền ────────────────────────────────────────────────────────────────
    const moduleCount = selectedModules.length
    const addrCount = selectedAddressIds.length
    const isBundle = moduleCount === 3
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
            const amountPer = isBundle ? Math.round(perAddress / 3) : PRICE.module[period]

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
            {/* ── Chọn báo cáo (thẻ cao cấp) ─────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
                <SectionHeader title="Chọn báo cáo" hint={isBundle ? undefined : 'Chọn đủ 3 để nhận giá trọn bộ'} />

                <div className="grid grid-cols-3 gap-2">
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

            </section>

            {/* ── Áp dụng cho chi nhánh ──────────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
                <SectionHeader
                    title="Áp dụng cho chi nhánh"
                    action={addresses.length > 1 && (
                        <button onClick={toggleAllAddresses} className="text-[11px] font-black text-primary uppercase tracking-wide">
                            {allAddressesSelected ? 'Bỏ tất cả' : 'Tất cả'}
                        </button>
                    )}
                />
                <div className="flex flex-col gap-1.5">
                    {addresses.map(addr => {
                        const active = selectedAddressIds.includes(addr.id)
                        return (
                            <button
                                key={addr.id}
                                onClick={() => toggleAddress(addr.id)}
                                className={`w-full text-left rounded-[12px] border px-2.5 py-1.5 flex items-center gap-2.5 transition-all duration-150
                                    ${active
                                        ? 'border-primary bg-primary/[0.07] shadow-[0_0_14px_rgba(245,158,11,0.12)]'
                                        : 'border-border/60 bg-surface-light hover:border-border-light'}`}
                            >
                                <span className={`w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0 text-[10.5px] font-black transition-colors
                                    ${active ? 'bg-primary/20 text-primary' : 'bg-surface-hover text-text-secondary'}`}>
                                    {initials(addr.name)}
                                </span>
                                <span className={`flex-1 min-w-0 text-[13px] font-bold truncate transition-colors ${active ? 'text-text' : 'text-text-secondary'}`}>
                                    {addr.name}
                                </span>
                            </button>
                        )
                    })}
                    {addresses.length === 0 && (
                        <p className="text-[12px] text-text-secondary py-2">Chưa có chi nhánh nào.</p>
                    )}
                </div>
            </section>

            {/* ── QR thanh toán ──────────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
                <SectionHeader title="Quét mã thanh toán" />
                <div className="relative mx-auto w-full max-w-[170px] aspect-square rounded-[20px] bg-surface-light border border-border/60 flex flex-col items-center justify-center gap-2 text-text-dim overflow-hidden">
                    {/* Corner brackets — khung kiểu quét mã */}
                    <Corner className="top-3 left-3 border-t-2 border-l-2 rounded-tl-[8px]" />
                    <Corner className="top-3 right-3 border-t-2 border-r-2 rounded-tr-[8px]" />
                    <Corner className="bottom-3 left-3 border-b-2 border-l-2 rounded-bl-[8px]" />
                    <Corner className="bottom-3 right-3 border-b-2 border-r-2 rounded-br-[8px]" />
                    <QrCode size={44} strokeWidth={1.5} />
                    <p className="text-[11px] font-medium px-6 text-center">Mã QR hiện sau khi xác nhận</p>
                </div>
            </section>

            {/* ── POS guarantee ──────────────────────────────────────────────────── */}
            <div className="flex items-start gap-2.5 rounded-[14px] bg-success-soft/60 border border-success/20 p-3">
                <ShieldCheck size={15} className="text-success mt-0.5 shrink-0" />
                <p className="text-[11.5px] text-success/90 leading-relaxed">
                    <span className="font-black">POS & chốt ca luôn hoạt động</span> — quán vẫn bán hàng bình thường khi chưa đăng ký.
                </p>
            </div>

            {/* ── Hoá đơn (dính đáy). Thanh toán xác nhận qua webhook (quét QR ở trên),
                   nên KHÔNG có nút "Thanh toán" — chỉ tổng kết + (admin) mock. ─────── */}
            <div className="sticky bottom-0 -mx-4 px-4 pt-3 bg-bg/85 backdrop-blur-md border-t border-border/50 pb-[max(env(safe-area-inset-bottom),12px)]">
                {/* Nhãn */}
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-text-dim">Tổng cộng</p>

                {/* Tổng tiền + meta inline (chu kỳ · báo cáo · chi nhánh) */}
                <div className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                    <span
                        className="text-[22px] font-black leading-none bg-clip-text text-transparent"
                        style={{ backgroundImage: GOLD }}
                    >
                        {formatVND(total)}
                    </span>
                    <span className="text-[10.5px] text-text-secondary tabular-nums">
                        / {PERIOD_LABEL[period]}<Dot />{moduleCount} báo cáo<Dot />{addrCount} chi nhánh
                    </span>
                    {savings > 0 && (
                        <span className="text-[10.5px]">
                            <Dot /><span className="text-text-dim line-through">{formatVND(originalTotal)}</span>
                            <span className="text-success font-bold ml-1">tiết kiệm {formatVND(savings)}</span>
                        </span>
                    )}
                </div>

                {isAdmin && (
                    <button
                        onClick={handleMockPayment}
                        disabled={isMocking || !canSubmit}
                        className="w-full mt-2.5 py-2 rounded-[12px] bg-red-500/10 text-red-500 text-[12px] font-bold hover:bg-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isMocking ? <Loader2 size={14} className="animate-spin" /> : 'Mock mở khoá (Admin)'}
                    </button>
                )}
            </div>
        </div>
    )
}

function SectionHeader({ title, hint, action }) {
    return (
        <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2.5">
                <span className="w-1 h-3.5 rounded-full bg-primary/70" />
                <p className="text-[12px] font-black text-text uppercase tracking-wider">{title}</p>
                {hint && <span className="text-[10px] text-text-dim normal-case font-medium tracking-normal">{hint}</span>}
            </div>
            {action}
        </div>
    )
}

function Dot() {
    return <span className="mx-1.5 text-text-dim">·</span>
}

function Corner({ className }) {
    return <span className={`absolute w-4 h-4 border-primary/40 ${className}`} />
}

// Lấy 1–2 chữ cái đầu các từ có nghĩa làm avatar chi nhánh.
function initials(name = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
