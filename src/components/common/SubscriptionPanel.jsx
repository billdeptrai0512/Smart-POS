import { useState, useEffect, useRef } from 'react'
import { QrCode, Loader2, CheckCircle2, Copy, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { supabase } from '../../lib/supabaseClient'
import { usePaymentListener } from '../../hooks/usePaymentListener'
import { formatVND } from '../../utils'
import { PLAN, ALL_TIER, BANK_INFO } from '../../constants/monetization'

// Gradient vàng thương hiệu (đồng bộ badge "developed by").
const GOLD = 'linear-gradient(135deg, #f8c577, #f59e0b, #d4882f, #b8732a)'

/**
 * SubscriptionPanel — thân trang đăng ký gói (checkout).
 * 1 gói duy nhất: 888,888đ / 6 tháng / 1 địa chỉ → mở khoá cả 3 view báo cáo.
 * Multi-branch: chọn nhiều chi nhánh → tổng = giá × số chi nhánh.
 *
 * Props: preselectAddressId, onDone
 */
export default function SubscriptionPanel({ preselectAddressId, onDone }) {
    const { isAdmin } = useAuth()
    const { addresses, selectedAddress } = useAddress()

    const [selectedAddressIds, setSelectedAddressIds] = useState([])

    // Chọn sẵn chi nhánh đang xem (hoặc chi nhánh đầu) — chạy 1 lần khi addresses sẵn sàng.
    // Dùng effect (không phải useState init) vì addresses load bất đồng bộ sau mount.
    const didInit = useRef(false)
    useEffect(() => {
        if (didInit.current || !addresses.length) return
        const want = preselectAddressId || selectedAddress?.id
        const valid = want && addresses.some(a => a.id === want) ? want : addresses[0].id
        setSelectedAddressIds([valid])
        didInit.current = true
    }, [addresses, preselectAddressId, selectedAddress?.id])
    const [isMocking, setIsMocking] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const [branchQuery, setBranchQuery] = useState('')
    const [copied, setCopied] = useState(null) // 'stk' | 'noidung' | null

    // valid_to (hạn) hiện tại của TỪNG chi nhánh → vừa hiện chip Đã mở/Chưa mở,
    // vừa tính "hiệu lực đến" sau khi trả (gia hạn nối tiếp). null = chưa có sub active.
    // Dùng cùng RPC với badge (get_address_entitlement) để khớp CURRENT_DATE của DB.
    const [validToByAddr, setValidToByAddr] = useState({})
    const [accessLoaded, setAccessLoaded] = useState(false)
    useEffect(() => {
        let cancelled = false
        if (!addresses.length) { setValidToByAddr({}); setAccessLoaded(true); return }
        setAccessLoaded(false)
        Promise.all(addresses.map(a =>
            supabase
                .rpc('get_address_entitlement', { p_address_id: a.id })
                .then(({ data }) => {
                    const rows = Array.isArray(data) ? data : (data ? [data] : [])
                    const vt = rows.reduce((mx, r) => (r.valid_to && (!mx || r.valid_to > mx) ? r.valid_to : mx), null)
                    return [a.id, vt]
                })
                .catch(() => [a.id, null])
        )).then(entries => {
            if (cancelled) return
            setValidToByAddr(Object.fromEntries(entries))
            setAccessLoaded(true)
        })
        return () => { cancelled = true }
    }, [addresses])

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
    const allAddressesSelected = addresses.length > 0 && selectedAddressIds.length === addresses.length
    const toggleAllAddresses = () =>
        setSelectedAddressIds(allAddressesSelected ? [] : addresses.map(a => a.id))

    // Nhiều chi nhánh → bật search + cuộn nội bộ.
    const manyBranches = addresses.length > 6
    const filteredAddresses = branchQuery.trim()
        ? addresses.filter(a => normalizeText(a.name).includes(normalizeText(branchQuery)))
        : addresses

    // ── Tính tiền: giá cố định × số chi nhánh ────────────────────────────────────
    const addrCount = selectedAddressIds.length
    const total = PLAN.price * addrCount
    const canSubmit = addrCount > 0

    // ── Hiệu lực đến: tính theo quy tắc gia hạn nối tiếp (§4) ─────────────────────
    // Đang có sub active → cộng tiếp sau hạn cũ; chưa có → tính từ hôm nay.
    const newExpiryFor = (addrId) => {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        let from = today
        const vt = validToByAddr[addrId]
        if (vt) {
            const next = new Date(vt + 'T00:00:00'); next.setDate(next.getDate() + 1)
            if (next > today) from = next
        }
        return addMonths(from, PLAN.months)
    }
    const fmtDate = (d) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const expiryDates = selectedAddressIds.map(newExpiryFor)
    const distinctExpiry = [...new Set(expiryDates.map(d => d.getTime()))]
    const expiryLabel = (addrCount === 0 || !accessLoaded)
        ? null
        : distinctExpiry.length === 1
            ? `Hiệu lực đến ${fmtDate(expiryDates[0])}`
            : 'Mỗi chi nhánh +6 tháng (nối tiếp)'

    // ── Nội dung CK: chuẩn hoá tên chi nhánh để admin đối soát ────────────────────
    const selectedNames = selectedAddressIds.map(id => addresses.find(a => a.id === id)?.name).filter(Boolean)
    const transferContent = selectedNames.length === 0
        ? ''
        : selectedNames.length === 1
            ? normalizeContent(selectedNames[0])
            : `${normalizeContent(selectedNames[0])} +${selectedNames.length - 1}CN`

    const copy = async (text, key) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(key)
            setTimeout(() => setCopied(null), 1500)
        } catch { /* clipboard không khả dụng — bỏ qua */ }
    }

    const handleMockPayment = async () => {
        if (!canSubmit) return
        setIsMocking(true)
        try {
            // Cấp/gia hạn qua RPC admin_set_subscription (SECURITY DEFINER, guard is_admin_auth).
            // RPC tự áp quy tắc gia hạn nối tiếp (§4) cho từng chi nhánh.
            const { error } = await supabase.rpc('admin_set_subscription', {
                p_address_ids: selectedAddressIds,
                p_modules: [ALL_TIER],
                p_months: PLAN.months,
                p_amount_paid: PLAN.price,
                p_note: 'admin_override',
            })
            if (error) throw error
            if (onDone) onDone()
            else window.location.reload()
        } catch (err) {
            alert('Lỗi: ' + err.message)
            setIsMocking(false)
        }
    }

    // Reset (dev/test): xoá sub của các chi nhánh đã chọn → về lại trạng thái khoá.
    const handleReset = async () => {
        if (!selectedAddressIds.length || isResetting) return
        if (!window.confirm('Xoá toàn bộ gói của chi nhánh đã chọn? (chỉ dùng để dev/test)')) return
        setIsResetting(true)
        try {
            const { error } = await supabase.rpc('admin_reset_subscription', {
                p_address_ids: selectedAddressIds,
                p_modules: null,   // null = xoá hết
            })
            if (error) throw error
            if (onDone) onDone()
            else window.location.reload()
        } catch (err) {
            alert('Lỗi: ' + err.message)
            setIsResetting(false)
        }
    }

    return (
        <div className="flex flex-col gap-5 animate-fade-in">
            {/* ── Chi nhánh (áp dụng ở đâu) ───────────────────────────────────────── */}
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
                        const hasAccess = !!validToByAddr[addr.id]
                        const statusChip = !accessLoaded
                            ? null
                            : hasAccess
                                ? <span className="shrink-0 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-success-soft/60 text-success">Đã mở</span>
                                : <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface text-text-dim">Chưa mở</span>
                        return (
                            <button
                                key={addr.id}
                                onClick={() => toggleAddress(addr.id)}
                                className={`w-full text-left rounded-[12px] border px-3 py-2 transition-all duration-150
                                    ${active
                                        ? 'border-primary bg-primary/[0.07] shadow-[0_0_14px_rgba(245,158,11,0.12)]'
                                        : 'border-border/60 bg-surface-light hover:border-border-light'}`}
                            >
                                <span className="flex items-center justify-between gap-2">
                                    <span className={`min-w-0 text-[13px] font-bold truncate transition-colors ${active ? 'text-text' : 'text-text-secondary'}`}>
                                        {addr.name}
                                    </span>
                                    {statusChip}
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

            {/* ── Thanh toán — 1 card gắn kết: QR + tổng cộng + status ───────────── */}
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
                            {addrCount === 0 ? (
                                <p className="text-[12px] text-text-secondary font-medium">Chọn chi nhánh để tính tiền</p>
                            ) : (
                                <>
                                    <p className="text-[9.5px] font-black uppercase tracking-[0.12em] text-text-secondary">Tổng cộng</p>
                                    <p className="text-[16px] font-black leading-none mt-1 mb-2 bg-clip-text text-transparent" style={{ backgroundImage: GOLD }}>
                                        {formatVND(total)}
                                    </p>
                                    <div className="text-[11px] text-text-secondary tabular-nums leading-[1.45]">
                                        <p>{PLAN.periodLabel}</p>
                                        <p>{addrCount} chi nhánh</p>
                                        {expiryLabel && <p className="text-text font-bold">{expiryLabel}</p>}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* status — cùng card, ngăn bằng hairline */}
                    <div className={`flex items-center gap-1.5 mt-3 pt-3 border-t border-border/40 text-[10.5px] ${confirmed ? 'text-success font-bold' : 'text-text-secondary'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full bg-success shrink-0 ${confirmed ? '' : 'animate-pulse'}`} />
                        {confirmed ? 'Đã nhận thanh toán — đang mở khoá…' : 'Đang chờ xác nhận chuyển khoản tự động…'}
                    </div>
                </div>

                {/* Hướng dẫn chuyển khoản (mở khoá tay) — STK + tên + nội dung CK */}
                {addrCount > 0 && (
                    <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-text-secondary">Chuyển khoản tới</p>
                        <CopyRow label="Ngân hàng" value={BANK_INFO.bank} />
                        <CopyRow label="Số TK" value={BANK_INFO.accountNumber} onCopy={() => copy(BANK_INFO.accountNumber, 'stk')} copied={copied === 'stk'} />
                        <CopyRow label="Chủ TK" value={BANK_INFO.accountName} />
                        <CopyRow label="Nội dung" value={transferContent} onCopy={() => copy(transferContent, 'noidung')} copied={copied === 'noidung'} />
                    </div>
                )}
            </section>

            {/* ── Footer dính đáy: nút Mock + Reset (Admin). User thường xác nhận qua webhook. ── */}
            {isAdmin && (
                <div className="sticky bottom-0 -mx-4 px-4 pt-3 bg-bg/85 backdrop-blur-md border-t border-border/50 pb-[max(env(safe-area-inset-bottom),12px)] flex flex-col gap-2">
                    <button
                        onClick={handleMockPayment}
                        disabled={isMocking || isResetting || !canSubmit}
                        className="w-full py-2.5 rounded-[12px] bg-red-500/10 text-red-500 text-[12px] font-bold hover:bg-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isMocking ? <Loader2 size={14} className="animate-spin" /> : 'Mock mở khoá (Admin)'}
                    </button>
                    <button
                        onClick={handleReset}
                        disabled={isMocking || isResetting || !selectedAddressIds.length}
                        className="w-full py-2 rounded-[12px] bg-surface-light text-text-secondary text-[11px] font-bold hover:bg-border/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isResetting ? <Loader2 size={14} className="animate-spin" /> : 'Reset gói (Admin · dev)'}
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

function CopyRow({ label, value, onCopy, copied }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-secondary shrink-0">{label}</span>
            <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-[12px] font-bold text-text truncate">{value}</span>
                {onCopy && (
                    <button
                        onClick={onCopy}
                        title="Sao chép"
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[8px] bg-surface-light border border-border/60 text-text-secondary hover:text-text active:scale-95 transition-all"
                    >
                        {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    </button>
                )}
            </span>
        </div>
    )
}

// Chuẩn hoá để search không phân biệt hoa/thường & dấu tiếng Việt.
function normalizeText(s = '') {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

// Nội dung CK: bỏ dấu, viết HOA, chỉ giữ chữ-số-khoảng trắng (ngân hàng dễ đọc).
function normalizeContent(s = '') {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
        .toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

// Cộng tháng, clamp về ngày cuối tháng nếu tràn — KHỚP Postgres `date + interval 'N months'`
// (vd 31/08 + 6 tháng → 28/02, không cuộn sang 03/03 như Date.setMonth mặc định).
function addMonths(date, months) {
    const d = new Date(date)
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + months)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDay))
    return d
}
