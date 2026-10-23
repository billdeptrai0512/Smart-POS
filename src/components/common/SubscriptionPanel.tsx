import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { Loader2, CheckCircle2, Check, ChevronDown, ClipboardCheck, Download } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAddressStats } from '../../contexts/AddressStatsContext'
import { createPaymentIntent, grantSubscription, resetSubscription } from '../../services/adminService'
import { usePaymentPoll } from '../../hooks/usePaymentPoll'
import { formatVND } from '../../utils'
import { PLAN, ALL_TIER, BANK_INFO, TRIAL_DAYS } from '../../constants/monetization'
import { computeSubscriptionStatus, expiryTone } from '../../utils/subscriptionStatus'
import { dateFullVN } from '../../utils/dateVN'
import { copyText } from '../../utils/clipboard'
import { errorMessage } from '../../utils/errorMessage'
import type { UUID } from '../../types/domain'
import { BottomSheet } from './ModalShell'

// Gradient vàng thương hiệu (đồng bộ badge "developed by").
const GOLD = 'linear-gradient(135deg, #f8c577, #f59e0b, #d4882f, #b8732a)'

// Thứ tự danh sách địa chỉ: hết dùng thử / chưa đăng ký (cần xử lý) → đang dùng thử → đã đăng ký → đang dùng miễn phí.
const statusRank = ({ status, pending }: ReturnType<typeof computeSubscriptionStatus>) =>
    status === 'trial' ? 1 : status === 'paid' ? 2 : pending ? 3 : 0
const PILL_TONE = { danger: 'bg-danger/10 text-danger', warning: 'bg-warning/10 text-warning', success: 'bg-success/10 text-success' }

/**
 * SubscriptionPanel — thân trang đăng ký gói (checkout).
 * 1 gói duy nhất: 888,888đ / 6 tháng / 1 địa chỉ → mở khoá cả 3 view báo cáo.
 * Multi-branch: chọn nhiều chi nhánh → tổng = giá × số chi nhánh.
 *
 * Props: preselectAddressId, onDone
 */
export default function SubscriptionPanel({ preselectAddressId, onDone }: { preselectAddressId?: UUID; onDone?: () => void }) {
    const { isAdmin } = useAuth()
    const { addresses, addressId } = useAddress()
    const { subscriptionRowsMap, subscriptionLoading, refreshSubscriptionStatuses } = useAddressStats()

    const [selectedAddressIds, setSelectedAddressIds] = useState<UUID[]>([])

    // Chọn sẵn chi nhánh đang xem (hoặc chi nhánh đầu) — chạy 1 lần khi addresses sẵn sàng.
    // Dùng effect (không phải useState init) vì addresses load bất đồng bộ sau mount.
    const didInit = useRef(false)
    useEffect(() => {
        if (didInit.current || !addresses.length) return
        const want = preselectAddressId || addressId
        const valid = want && addresses.some(a => a.id === want) ? want : addresses[0].id
        // eslint-disable-next-line react-hooks/set-state-in-effect -- init 1 lần khi addresses về (didInit chặn lặp)
        setSelectedAddressIds([valid])
        didInit.current = true
    }, [addresses, preselectAddressId, addressId])
    const [isMocking, setIsMocking] = useState(false)
    const [isTrialMock, setIsTrialMock] = useState(false) // Mock cấp trial 7 ngày (khác admin_override 6 tháng)
    const [isResetting, setIsResetting] = useState(false)
    const [confirmReset, setConfirmReset] = useState(false) // 2-step confirm (không dùng window.confirm — bị chặn trong webview)
    const [adminError, setAdminError] = useState<string | null>(null)
    const [confirmed, setConfirmed] = useState(false)
    const [branchQuery, setBranchQuery] = useState('')
    const [pickerOpen, setPickerOpen] = useState(false)
    const [adminOpen, setAdminOpen] = useState(false)
    const [copied, setCopied] = useState<string | null>(null) // 'stk' | 'noidung' | null
    const [reference, setReference] = useState<string | null>(null) // mã CK (SP<reference>) từ payment_intent
    const [refError, setRefError] = useState(false)
    const [refRetry, setRefRetry] = useState(0) // tăng → chạy lại effect tạo intent
    const [reviewHold, setReviewHold] = useState(false) // CK sai số tiền → chờ admin duyệt tay

    // Trạng thái gói + valid_to (hạn) hiện tại của TỪNG chi nhánh → vừa hiện trạng thái từng dòng,
    // vừa tính "hiệu lực đến" sau khi trả (gia hạn nối tiếp). null = chưa có sub active.
    // Derived từ subscriptionRowsMap (AddressStatsContext) — 1 query dùng chung cho
    // cả badge danh sách lẫn panel này, thay vì mỗi nơi tự RPC riêng cho từng chi nhánh.
    const subByAddr = useMemo(() => Object.fromEntries(
        addresses.map(a => [a.id, computeSubscriptionStatus(subscriptionRowsMap[a.id])])
    ), [addresses, subscriptionRowsMap])
    const accessLoaded = !subscriptionLoading

    // Xác nhận thanh toán: hiện panel thành công, user tự bấm "Xong" (không auto-redirect).
    // Làm tươi rows/status dùng chung (badge từng card + thứ tự sort + panel này) —
    // dùng cho cả mock trial và poll-while-pending (usePaymentPoll).
    const handleConfirmed = () => {
        refreshSubscriptionStatuses()
        setConfirmed(true)
    }

    // Poll-while-pending (§7.1) — xác nhận thanh toán: poll status của intent đang
    // chờ mỗi 4s, thấy 'paid' → confirm (guard chung `confirmed`). Thay cho realtime
    // (subpay-* channel) — stateless, không tốn quota kết nối realtime ở quy mô lớn,
    // độ trễ vài giây không đáng kể so với chuyển khoản ngân hàng (5-30s).
    // manual_review = đã nhận tiền nhưng sai số tiền → báo user chờ admin (KHÔNG lặng lẽ
    // đổi mã QR mới). Hết hạn/huỷ → tạo intent mới để QR luôn dùng mã còn hiệu lực.
    const { connected } = usePaymentPoll({
        reference,
        enabled: !confirmed && !reviewHold,
        onPaid: handleConfirmed,
        onExpired: (status) => {
            if (status === 'manual_review') setReviewHold(true)
            else setRefRetry(n => n + 1)
        },
    })

    const toggleAddress = (id: UUID) => setSelectedAddressIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    const allAddressesSelected = addresses.length > 0 && selectedAddressIds.length === addresses.length
    const toggleAllAddresses = () =>
        setSelectedAddressIds(allAddressesSelected ? [] : addresses.map(a => a.id))

    // Nhiều chi nhánh → bật search + cuộn nội bộ.
    const manyBranches = addresses.length > 6
    const matched = branchQuery.trim()
        ? addresses.filter(a => normalizeText(a.name).includes(normalizeText(branchQuery)))
        : addresses
    // Sort ổn định nên thứ tự cũ giữ trong mỗi nhóm.
    const filteredAddresses = [...matched].sort((a, b) => statusRank(subByAddr[a.id]) - statusRank(subByAddr[b.id]))

    // ── Tính tiền: giá cố định × số chi nhánh ────────────────────────────────────
    const addrCount = selectedAddressIds.length
    const total = PLAN.price * addrCount
    const canSubmit = addrCount > 0

    // ── Hiệu lực đến: tính theo quy tắc gia hạn nối tiếp (§4) ─────────────────────
    // Đang có sub active → cộng tiếp sau hạn cũ; chưa có → tính từ hôm nay.
    const newExpiryFor = (addrId: UUID) => {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        let from = today
        const vt = subByAddr[addrId].validTo
        if (vt) {
            const next = new Date(vt + 'T00:00:00'); next.setDate(next.getDate() + 1)
            if (next > today) from = next
        }
        if (isTrialMock) {
            const d = new Date(from); d.setDate(d.getDate() + TRIAL_DAYS)
            return d
        }
        return addMonths(from, PLAN.months)
    }
    // ── Nội dung CK: 'SP' + reference của payment_intent (webhook SePay đối chiếu) ─
    // Tạo intent khi đổi tập chi nhánh / số tiền → reference cố định cho lần CK này.
    const selectedKey = [...selectedAddressIds].sort().join(',')
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset reference khi không còn gì để thanh toán
        if (addrCount === 0 || total <= 0) { setReference(null); return }
        let cancelled = false
        setRefError(false)
        createPaymentIntent(selectedAddressIds, PLAN.months, total).then(
            (data) => { if (!cancelled) { setReference(data); setRefError(false) } },
            () => { if (!cancelled) { setReference(null); setRefError(true) } },
        )
        return () => { cancelled = true }
    }, [selectedKey, total, refRetry]) // eslint-disable-line react-hooks/exhaustive-deps

    const transferContent = reference ? `SP${reference}` : ''

    // ── QR chuyển khoản (SePay): tự điền số tiền + nội dung ───────────────────────
    const qrUrl = `https://qr.sepay.vn/img?bank=MBBank&acc=${BANK_INFO.accountNumber}&template=&amount=${total}&des=${encodeURIComponent(transferContent)}`

    const copy = async (text: string, key: string) => {
        if (await copyText(text)) {
            setCopied(key)
            setTimeout(() => setCopied(null), 1500)
        }
    }

    // Lưu ảnh QR để chọn từ thư viện trong app ngân hàng; Web Share (bảng chia sẻ hệ điều hành) nếu có, không thì mở ảnh tab mới để nhấn giữ lưu.
    const saveQr = async () => {
        try {
            const blob = await (await fetch(qrUrl)).blob()
            const file = new File([blob], `QR-${transferContent}.png`, { type: 'image/png' })
            if (navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file] })
        } catch (err) {
            if ((err as Error).name === 'AbortError') return
        }
        window.open(qrUrl, '_blank')
    }

    const handleMockPayment = async () => {
        if (!canSubmit) return
        setIsMocking(true)
        setAdminError(null)
        try {
            // Cấp trial 7 ngày qua RPC admin_set_subscription (note='trial' → RPC tự dùng
            // 7 ngày cố định, bỏ qua p_months — xem 20260709_admin_mock_trial_grant.sql).
            // Dùng để test flow + cấp lại trial thủ công khi trial tự động bị chặn.
            await grantSubscription(selectedAddressIds, [ALL_TIER], 1, 0, 'trial')
            // Đi cùng đường với webhook thật → hiện panel xác nhận (test được UI success).
            // handleConfirmed() tự invalidate cache + refresh sort bên dưới.
            setIsTrialMock(true)
            setIsMocking(false)
            handleConfirmed()
        } catch (err) {
            setAdminError('Lỗi: ' + errorMessage(err, 'không rõ nguyên nhân'))
            setIsMocking(false)
        }
    }

    // Reset (dev/test): xoá sub của các chi nhánh đã chọn → về lại trạng thái khoá.
    // 2-step confirm inline: window.confirm bị chặn/treo trong webview & preview panel.
    const handleReset = async () => {
        if (!selectedAddressIds.length || isResetting) return
        if (!confirmReset) {
            setConfirmReset(true)
            setTimeout(() => setConfirmReset(false), 4000) // tự huỷ sau 4s nếu không bấm tiếp
            return
        }
        setConfirmReset(false)
        setIsResetting(true)
        setAdminError(null)
        try {
            await resetSubscription(selectedAddressIds)
            refreshSubscriptionStatuses()
            if (onDone) onDone()
            else window.location.reload()
        } catch (err) {
            setAdminError('Lỗi: ' + errorMessage(err, 'không rõ nguyên nhân'))
            setIsResetting(false)
        }
    }

    // ── Panel xác nhận thanh toán thành công ─────────────────────────────────────
    // newExpiryFor tính từ subByAddr TRƯỚC khi trả (gia hạn nối tiếp §4) = đúng
    // hạn mới sau khi webhook insert sub. User tự bấm "Xong", không auto-redirect.
    if (confirmed) {
        return (
            <div className="flex flex-col gap-4 animate-fade-in pt-4">
                <div className="rounded-[18px] border border-success/30 bg-success-soft/40 px-4 py-7 flex flex-col items-center gap-3 text-center">
                    <CheckCircle2 size={52} strokeWidth={1.6} className="text-success animate-scale-up" />
                    <div>
                        <p className="text-[16px] font-black text-text">{isTrialMock ? 'Đã cấp trial' : 'Thanh toán thành công'}</p>
                        <p className="text-[12px] text-text-secondary mt-1">
                            {isTrialMock
                                ? `Trial ${TRIAL_DAYS} ngày · ${addrCount} chi nhánh`
                                : `Đã mở khoá ${addrCount} chi nhánh · ${formatVND(total)}`}
                        </p>
                    </div>
                </div>

                {/* Mỗi chi nhánh 1 card xác nhận — khớp format panel Thông tin */}
                {selectedAddressIds.map(id => (
                    <div key={id} className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2">
                        <CopyRow label="Địa chỉ" value={addresses.find(a => a.id === id)?.name || '—'} />
                        <CopyRow label="Thời hạn" value={isTrialMock ? `${TRIAL_DAYS} ngày` : PLAN.periodLabel} />
                        <CopyRow label="Sử dụng đến" value={dateFullVN(newExpiryFor(id))} />
                    </div>
                ))}

                <button
                    onClick={() => { onDone ? onDone() : window.location.reload() }}
                    className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase hover:bg-primary/90 active:scale-[0.98] transition-all"
                >
                    Xong
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-5 animate-fade-in">
            {/* ── Địa chỉ + hạn: mỗi địa chỉ đã chọn 1 dòng "tên | đến ngày" (gia hạn nối tiếp nên hạn mỗi chi nhánh có thể khác nhau). "Đổi" mở sheet chọn. ── */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader
                    title="Địa chỉ"
                    action={addresses.length > 0 && (
                        <button onClick={() => setPickerOpen(true)} className="text-[11px] font-black text-primary uppercase tracking-wide whitespace-nowrap">
                            {addrCount > 0 ? 'Đổi' : 'Chọn'}
                        </button>
                    )}
                />
                <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2 max-h-[168px] overflow-y-auto">
                    {addrCount > 0 ? selectedAddressIds.map(id => (
                        <div key={id} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-[13px] font-bold text-text">{addresses.find(a => a.id === id)?.name || '—'}</span>
                            <span className="shrink-0 text-[12px] text-text-secondary tabular-nums">đến {accessLoaded ? dateFullVN(newExpiryFor(id)) : '…'}</span>
                        </div>
                    )) : (
                        <p className="text-[12px] text-text-secondary font-medium">{addresses.length === 0 ? 'Chưa có chi nhánh nào.' : 'Chọn chi nhánh để đăng ký'}</p>
                    )}
                </div>
            </section>

            {pickerOpen && (
                <BottomSheet onClose={() => setPickerOpen(false)} panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-6 flex flex-col gap-3 animate-slide-up max-h-[85dvh]">
                    <SectionHeader
                        title="Chọn địa chỉ"
                        hint={`${addrCount}/${addresses.length}`}
                        action={addresses.length > 1 && (
                            <button onClick={toggleAllAddresses} className="text-[11px] font-black text-primary uppercase tracking-wide whitespace-nowrap">
                                {allAddressesSelected ? 'Bỏ tất cả' : 'Tất cả'}
                            </button>
                        )}
                    />
                    {manyBranches && (
                        <input
                            type="text"
                            value={branchQuery}
                            onChange={e => setBranchQuery(e.target.value)}
                            placeholder="Tìm chi nhánh…"
                            className="w-full px-3 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text text-[13px] placeholder:text-text-dim focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                        />
                    )}
                    <div className="min-h-0 flex flex-col gap-1.5 overflow-y-auto">
                        {filteredAddresses.map(addr => {
                            const active = selectedAddressIds.includes(addr.id)
                            const { status, daysLeft = 0, pending, trialEnded } = subByAddr[addr.id]
                            const [pillText, pillCls] = status !== 'none'
                                ? [`${status === 'trial' ? 'Dùng thử · ' : ''}còn ${daysLeft} ngày`, PILL_TONE[expiryTone(daysLeft)]]
                                : pending ? ['Đang dùng miễn phí', 'bg-surface text-text-dim']
                                : [trialEnded ? 'Hết dùng thử' : 'Chưa đăng ký', 'bg-primary/10 text-primary']
                            return (
                                <button
                                    key={addr.id}
                                    onClick={() => toggleAddress(addr.id)}
                                    className={`w-full flex items-center gap-2 text-left rounded-[12px] border px-3 py-2 transition-colors ${active ? 'border-primary bg-primary/[0.07]' : 'border-border/60 bg-surface-light'}`}
                                >
                                    <span className={`min-w-0 flex-1 text-[13px] font-bold truncate ${active ? 'text-text' : 'text-text-secondary'}`}>{addr.name}</span>
                                    {/* Pill: còn X ngày (đã đăng ký) / Dùng thử · còn X ngày — màu theo độ gấp như chấm của SubscriptionBadge (>14 xanh, ≤14 vàng, ≤3 đỏ); Đang dùng miễn phí (xám) / Hết dùng thử / Chưa đăng ký (cam). */}
                                    {accessLoaded && <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${pillCls}`}>{pillText}</span>}
                                    {active && <Check size={15} strokeWidth={3} className="shrink-0 text-primary" />}
                                </button>
                            )
                        })}
                        {filteredAddresses.length === 0 && <p className="text-[12px] text-text-secondary py-2">Không tìm thấy chi nhánh.</p>}
                    </div>
                    <button
                        onClick={() => setPickerOpen(false)}
                        className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase active:scale-[0.98] transition"
                    >
                        Xong{addrCount > 0 && ` (${addrCount})`}
                    </button>
                </BottomSheet>
            )}

            {/* ── Thanh toán — 1 card gắn kết: QR + tổng cộng + status ───────────── */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader
                    title="Thanh toán"
                    action={!!reference && !reviewHold && (
                        // Phản ánh đúng trạng thái poll xác nhận (usePaymentPoll): xanh nhấp nháy = đang theo dõi, CK xong tự xác nhận;
                        // vàng đứng yên + chữ = lần poll gần nhất lỗi, chưa cập nhật được (chỉ ngoại lệ mới có chữ).
                        connected
                            ? (
                                <span role="status" aria-label="Đang chờ chuyển khoản" title="Đang chờ chuyển khoản" className="relative flex w-2.5 h-2.5 mr-1.5">
                                    <span className="absolute inset-0 rounded-full bg-success opacity-75 animate-ping" />
                                    <span className="relative w-2.5 h-2.5 rounded-full bg-success ring-4 ring-success/20" />
                                </span>
                            )
                            : (
                                <span role="status" title="Chưa cập nhật được thanh toán, đang thử lại" className="flex items-center gap-1.5 text-[10px] font-bold text-warning">
                                    <span className="w-2.5 h-2.5 rounded-full bg-warning ring-4 ring-warning/20" />
                                    Mất kết nối
                                </span>
                            )
                    )}
                />
                <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3.5">
                    {/* QR — đứng giữa, một mình */}
                    <div className="flex justify-center py-1">
                        <div className="relative w-[min(62%,220px)] aspect-square shrink-0 rounded-[16px] border flex items-center justify-center overflow-hidden bg-surface-light border-border/60 text-text-dim">
                            <Corner className="top-2 left-2 border-t-2 border-l-2 rounded-tl-[6px]" />
                            <Corner className="top-2 right-2 border-t-2 border-r-2 rounded-tr-[6px]" />
                            <Corner className="bottom-2 left-2 border-b-2 border-l-2 rounded-bl-[6px]" />
                            <Corner className="bottom-2 right-2 border-b-2 border-r-2 rounded-br-[6px]" />
                            {reference
                                ? <img src={qrUrl} alt="QR chuyển khoản" className="w-full h-full object-contain p-2.5 bg-white" />
                                : refError
                                    ? (
                                        <button onClick={() => setRefRetry(n => n + 1)} className="flex flex-col items-center gap-1 text-text-secondary">
                                            <span className="text-[10px] font-bold">Không tạo được mã</span>
                                            <span className="text-[10.5px] font-black text-primary">Thử lại</span>
                                        </button>
                                    )
                                    : <Loader2 size={28} strokeWidth={1.8} className="animate-spin text-text-dim" />}
                        </div>
                    </div>

                    {/* Tổng tiền — ngay dưới QR, không nhãn */}
                    {addrCount > 0 && (
                        <div className="mt-2 flex items-center justify-center gap-3">
                            <span className="text-[22px] font-black bg-clip-text text-transparent" style={{ backgroundImage: GOLD }}>{formatVND(total)}</span>
                            {reference && (
                                <button
                                    onClick={saveQr}
                                    aria-label="Lưu ảnh QR"
                                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[10px] bg-surface-light border border-border/60 text-text-secondary hover:text-text active:scale-95 transition-all"
                                >
                                    <Download size={15} strokeWidth={2.5} />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Thông tin thanh toán — ngân hàng + STK + nội dung CK */}
                    {addrCount > 0 ? (
                        <div className="mt-3.5 pt-3.5 border-t border-border/40 flex flex-col gap-2.5">
                            <CopyRow label="Ngân hàng" value={BANK_INFO.bank} />
                            <CopyRow label="Số tài khoản" value={BANK_INFO.accountNumber} onCopy={() => copy(BANK_INFO.accountNumber, 'stk')} copied={copied === 'stk'} />
                            <CopyRow label="Nội dung" value={transferContent} onCopy={() => copy(transferContent, 'noidung')} copied={copied === 'noidung'} />
                        </div>
                    ) : (
                        <p className="mt-3.5 pt-3.5 border-t border-border/40 text-[12px] text-text-secondary font-medium">Chọn chi nhánh để tính tiền</p>
                    )}

                    {/* status — chỉ khi CK sai số tiền; cùng card, ngăn bằng hairline */}
                    {reviewHold && (
                        <div className="mt-3 pt-3 border-t border-border/40 flex gap-2 text-[10.5px] leading-[1.6] font-bold text-warning">
                            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0 mt-[5px]" />
                            <span>Đã nhận chuyển khoản nhưng số tiền chưa khớp — admin sẽ kiểm tra và mở khoá thủ công.</span>
                        </div>
                    )}
                </div>
            </section>



            {/* ── Footer dính đáy: nút Mock + Reset (Admin). User thường xác nhận qua webhook. ── */}
            {isAdmin && (
                <div className="sticky bottom-0 -mx-4 px-4 pt-2 bg-bg/85 backdrop-blur-md border-t border-border/50 pb-[max(env(safe-area-inset-bottom),8px)] flex flex-col gap-2">
                    <button
                        onClick={() => setAdminOpen(o => !o)}
                        className="self-center flex items-center gap-1 text-[11px] font-bold text-text-dim active:scale-95 transition"
                    >
                        Admin <ChevronDown size={13} className={`transition-transform ${adminOpen ? '' : 'rotate-180'}`} />
                    </button>
                    {adminOpen && (
                        <>
                            <button
                                onClick={handleMockPayment}
                                disabled={isMocking || isResetting || !canSubmit}
                                className="w-full py-2.5 rounded-[12px] bg-danger/10 text-danger text-[12px] font-bold hover:bg-danger/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isMocking ? <Loader2 size={14} className="animate-spin" /> : `Mock trial ${TRIAL_DAYS} ngày (Admin)`}
                            </button>
                            <button
                                onClick={handleReset}
                                disabled={isMocking || isResetting || !selectedAddressIds.length}
                                className={`w-full py-2 rounded-[12px] text-[11px] font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50
                                    ${confirmReset ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-surface-light text-text-secondary hover:bg-border/40'}`}
                            >
                                {isResetting
                                    ? <Loader2 size={14} className="animate-spin" />
                                    : confirmReset ? 'Bấm lần nữa để xoá gói đã chọn' : 'Reset gói (Admin · dev)'}
                            </button>
                        </>
                    )}
                    {adminError && <p className="text-[10.5px] text-danger text-center">{adminError}</p>}
                </div>
            )}
        </div>
    )
}

function SectionHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
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

function Corner({ className }: { className: string }) {
    return <span className={`absolute w-4 h-4 border-primary/40 ${className}`} />
}

// onCopy: giá trị là nút chạm-để-sao-chép — gạch chân chấm gợi ý bấm được, vùng chạm nới ra bằng py/-my, sao chép xong đổi xanh + dấu ✓.
function CopyRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy?: () => void; copied?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-secondary shrink-0">{label}</span>
            {onCopy ? (
                <button
                    onClick={onCopy}
                    className={`min-w-0 py-1.5 -my-1.5 flex items-center gap-1.5 text-[12px] font-bold text-right break-all underline decoration-dotted underline-offset-4 active:opacity-60 transition-colors ${copied ? 'text-success decoration-success' : 'text-text decoration-text-dim'}`}
                >
                    {copied && <ClipboardCheck size={13} strokeWidth={2.5} className="shrink-0" />}
                    {value}
                </button>
            ) : (
                <span className="text-[12px] font-bold text-text text-right min-w-0">{value}</span>
            )}
        </div>
    )
}

// Chuẩn hoá để search không phân biệt hoa/thường & dấu tiếng Việt.
function normalizeText(s = '') {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

// Cộng tháng, clamp về ngày cuối tháng nếu tràn — KHỚP Postgres `date + interval 'N months'`
// (vd 31/08 + 6 tháng → 28/02, không cuộn sang 03/03 như Date.setMonth mặc định).
function addMonths(date: Date, months: number) {
    const d = new Date(date)
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + months)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDay))
    return d
}
