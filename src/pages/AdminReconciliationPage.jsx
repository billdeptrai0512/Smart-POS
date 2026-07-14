import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ArrowLeft, Loader2, AlertTriangle, Gift, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formatVND } from '../utils/money'
import { dateStringVN, timeStringVN } from '../utils/dateVN'
import { fetchAdminDashboard } from '../services/adminDashboardService'
import { resolvePaymentIntent, fetchReferralRewards } from '../services/reconciliationService'

const REASON_LABEL = {
    payment_review: 'Lệch tiền',
    payment_stale: 'Thanh toán treo',
    trial_ending: 'Dùng thử sắp hết',
    expiring: 'Sắp hết hạn',
    inactive: 'Không hoạt động',
}
const REASON_TAG_CLASS = {
    payment_review: 'bg-red-500/10 text-red-500',
    payment_stale: 'bg-warning-soft/60 text-warning',
    trial_ending: 'bg-warning-soft text-warning',
    expiring: 'bg-warning-soft text-warning',
    inactive: 'bg-danger-soft text-danger',
}

const fmtDT = (iso) => {
    const d = new Date(iso)
    return `${dateStringVN(d).split('-').reverse().join('/')} ${timeStringVN(d)}`
}

const elapsedMinutes = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
const daysLeft = (dateStr) => Math.ceil((new Date(dateStr) - Date.now()) / 86_400_000)

function attentionDetail(item) {
    if (item.reason === 'expiring') {
        const d = daysLeft(item.valid_to)
        return d <= 0 ? 'Hết hạn hôm nay' : `Hết hạn ${d} ngày nữa`
    }
    if (item.reason === 'trial_ending') {
        const d = daysLeft(item.valid_to)
        return d <= 0 ? 'Dùng thử hết hôm nay' : `Dùng thử còn ${d} ngày`
    }
    if (item.reason === 'inactive') {
        return item.last_active_at
            ? `Không hoạt động ${Math.floor((Date.now() - new Date(item.last_active_at).getTime()) / 86_400_000)} ngày`
            : 'Chưa từng hoạt động'
    }
    return `Mã SP${item.reference} · ${fmtDT(item.intent_created_at)}`
}

function itemKey(item) {
    return item.intent_id || `${item.reason}:${item.address_id}`
}

/**
 * AdminReconciliationPage — route /admin/reconciliation. Chỉ admin (RLS + RPC
 * admin_set_subscription/admin_resolve_payment_intent tự guard is_admin_auth,
 * đây chỉ là gate UX).
 *
 * Trang hành động duy nhất cho mọi thứ dashboard flag trong "Cần chú ý":
 * lệch tiền / thanh toán treo (grant-cấp gói hoặc bỏ qua) và sắp hết hạn /
 * dùng thử sắp hết / không hoạt động (gọi chủ quán). Dữ liệu lấy từ cùng
 * admin_dashboard_overview() RPC như trang dashboard — 1 nguồn duy nhất,
 * tránh 2 trang lệch ngưỡng/label nhau.
 */
export default function AdminReconciliationPage() {
    const navigate = useNavigate()
    const { isAdmin, loading: authLoading } = useAuth()

    const [items, setItems] = useState(null)
    const [rewards, setRewards] = useState(null)
    const [busyId, setBusyId] = useState(null)
    const [confirmId, setConfirmId] = useState(null) // 2-step confirm cho "Cấp gói tay"
    const [error, setError] = useState(null)

    const reload = useCallback(() => {
        fetchAdminDashboard().then((d) => setItems(d.attention)).catch((e) => setError(e.message))
        fetchReferralRewards().then(setRewards).catch((e) => setError(e.message))
    }, [])

    useEffect(() => {
        if (isAdmin) reload()
    }, [isAdmin, reload])

    if (authLoading) return null
    if (!isAdmin) return <Navigate to="/addresses" />

    const handleResolve = async (id, grant) => {
        if (grant && confirmId !== id) {
            setConfirmId(id)
            setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 4000)
            return
        }
        setConfirmId(null)
        setBusyId(id)
        setError(null)
        try {
            await resolvePaymentIntent(id, grant)
            setItems((prev) => prev.filter((i) => i.intent_id !== id))
        } catch (e) {
            setError(e.message)
        } finally {
            setBusyId(null)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
                <button
                    onClick={() => navigate('/admin/dashboard')}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <div className="flex-1 min-w-0 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-3 py-2.5 flex items-center justify-center">
                    <span className="text-[12px] font-black text-primary uppercase tracking-wide">Đối soát thanh toán</span>
                </div>
                <button
                    onClick={reload}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text-secondary hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                >
                    <RefreshCw size={16} strokeWidth={2.5} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 flex flex-col gap-5">
                {error && (
                    <p className="text-[12px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-[12px] px-3 py-2">
                        Lỗi: {error}
                    </p>
                )}

                {/* ── Cần chú ý ─────────────────────────────────────────────── */}
                <section className="flex flex-col gap-2.5">
                    <SectionHeader
                        icon={<AlertTriangle size={14} className="text-warning" />}
                        title="Cần chú ý"
                        hint={items ? `${items.length} chi nhánh` : undefined}
                    />
                    {items === null ? (
                        <Loader2 size={20} className="animate-spin text-text-dim mx-auto my-4" />
                    ) : items.length === 0 ? (
                        <EmptyCard text="Không có chi nhánh nào cần xử lý." />
                    ) : (
                        items.map((it) => {
                            const key = itemKey(it)
                            return (
                                <AttentionItemCard
                                    key={key}
                                    item={it}
                                    busy={busyId === key}
                                    confirming={confirmId === key}
                                    onGrant={() => handleResolve(key, true)}
                                    onDismiss={() => handleResolve(key, false)}
                                />
                            )
                        })
                    )}
                </section>

                {/* ── Referral reward ───────────────────────────────────────── */}
                <section className="flex flex-col gap-2.5">
                    <SectionHeader
                        icon={<Gift size={14} className="text-primary" />}
                        title="Referral reward"
                        hint={rewards ? `${rewards.length}` : undefined}
                    />
                    {rewards === null ? (
                        <Loader2 size={20} className="animate-spin text-text-dim mx-auto my-4" />
                    ) : rewards.length === 0 ? (
                        <EmptyCard text="Chưa có referral nào được thưởng." />
                    ) : (
                        rewards.map((r) => (
                            <div key={r.id} className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[13px] font-bold text-text truncate">{r.referrer?.name || '—'}</span>
                                    <span className="text-[11px] font-black text-success shrink-0">+1 tháng</span>
                                </div>
                                <p className="text-[11px] text-text-secondary">
                                    Mời <b className="text-text">{r.name}</b> · {fmtDT(r.referral_rewarded_at)}
                                </p>
                            </div>
                        ))
                    )}
                </section>
            </div>
        </div>
    )
}

function AttentionItemCard({ item, busy, confirming, onGrant, onDismiss }) {
    const isPayment = item.reason === 'payment_review' || item.reason === 'payment_stale'
    const tagLabel = item.reason === 'payment_stale' ? `Pending ${elapsedMinutes(item.intent_created_at)}'` : REASON_LABEL[item.reason]

    return (
        <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-text truncate">
                    {item.name}
                    {item.branch_extra > 0 && <span className="text-text-dim font-medium"> +{item.branch_extra} khác</span>}
                </span>
                <span className={`shrink-0 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full ${REASON_TAG_CLASS[item.reason]}`}>
                    {tagLabel}
                </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                <span>{attentionDetail(item)}</span>
                {isPayment && <span className="font-black text-text shrink-0">{formatVND(item.amount)}</span>}
            </div>
            <div className="flex gap-2 pt-1">
                {isPayment ? (
                    <>
                        <button
                            onClick={onGrant}
                            disabled={busy}
                            className={`flex-1 py-2 rounded-[10px] text-[11px] font-bold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5
                                ${confirming ? 'bg-success/20 text-success' : 'bg-success-soft/60 text-success hover:bg-success/20'}`}
                        >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : confirming ? 'Bấm lần nữa để cấp' : 'Đã nhận tiền — Cấp gói'}
                        </button>
                        <button
                            onClick={onDismiss}
                            disabled={busy}
                            className="px-3 py-2 rounded-[10px] text-[11px] font-bold bg-surface-light text-text-secondary hover:bg-border/40 active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            Bỏ qua
                        </button>
                    </>
                ) : item.owner_phone ? (
                    <a
                        href={`tel:${item.owner_phone}`}
                        className="flex-1 py-2 rounded-[10px] text-[11px] font-bold text-center bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.98] transition-all"
                    >
                        Gọi {item.owner_name ? item.owner_name.split(' ').slice(-1)[0] : 'chủ quán'}
                    </a>
                ) : (
                    <span className="flex-1 py-2 text-[11px] text-text-dim text-center">Không có SĐT liên hệ</span>
                )}
            </div>
        </div>
    )
}

function SectionHeader({ icon, title, hint }) {
    return (
        <div className="flex items-center gap-2 px-0.5">
            {icon}
            <p className="text-[12px] font-black text-text uppercase tracking-wider">{title}</p>
            {hint && <span className="text-[10px] text-text-dim normal-case font-medium">{hint}</span>}
        </div>
    )
}

function EmptyCard({ text }) {
    return (
        <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-4 text-center">
            <p className="text-[12px] text-text-secondary font-medium">{text}</p>
        </div>
    )
}
