import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { formatVND } from '../utils/money'
import { dateStringVN, timeStringVN } from '../utils/dateVN'
import { fetchAdminDashboard } from '../services/adminDashboardService'
import { resolvePaymentIntent, dismissAttention } from '../services/reconciliationService'
import { grantSubscription } from '../services/adminService'
import { ALL_TIER } from '../constants/monetization'
import { errorMessage } from '../utils/errorMessage'
import AdminPageHeader from '../components/common/AdminPageHeader'

// Một dòng của admin_dashboard_overview().attention / dormant_addresses. Trường nào có tuỳ theo `reason`.
interface AttentionItem {
    reason: string
    name: string
    intent_id?: string | null
    address_id?: string
    valid_to: string
    last_active_at: string | null
    intent_created_at: string
    reference?: string | number
    amount?: number
    branch_extra?: number
    owner_phone?: string | null
    owner_name?: string | null
}

// admin_dashboard_overview(): chỉ phần trang này đọc. dormant (v5) = đã bỏ >90 ngày, KHÔNG tính vào KPI "Cần chú ý".
interface Overview {
    attention: AttentionItem[]
    attention_total_count?: number
    payment_issues?: AttentionItem[] // v8: giao dịch cần đối soát, không tính vào attention_total_count
    dormant_addresses?: AttentionItem[]
    dormant_count?: number
}

const WARN = 'bg-warning-soft text-warning'
const DANGER = 'bg-danger-soft text-danger'
const REASON: Record<string, { label: string; cls: string }> = {
    payment_review: { label: 'Lệch tiền', cls: 'bg-red-500/10 text-red-500' },
    payment_stale: { label: 'Thanh toán treo', cls: 'bg-warning-soft/60 text-warning' },
    trial_ending: { label: 'Dùng thử sắp hết', cls: WARN },
    expiring: { label: 'Sắp hết hạn', cls: WARN },
    inactive: { label: 'Không hoạt động', cls: DANGER },
    churned_recent: { label: 'Đã rời bỏ', cls: DANGER },
    trial_missing: { label: 'Chưa bắt đầu trial', cls: WARN },
    dormant: { label: 'Đã bỏ (>90 ngày)', cls: 'bg-border/60 text-text-dim' },
}

const fmtDT = (iso: string) => {
    const d = new Date(iso)
    return `${dateStringVN(d).split('-').reverse().join('/')} ${timeStringVN(d)}`
}

const elapsedMinutes = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
const daysLeft = (dateStr: string) => Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)

function attentionDetail(item: AttentionItem) {
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
            ? `Không hoạt động ${daysSince(item.last_active_at)} ngày`
            : 'Chưa từng hoạt động'
    }
    if (item.reason === 'churned_recent') {
        const d = daysSince(item.valid_to)
        return d <= 0 ? 'Vừa hết hạn hôm nay' : `Hết hạn ${d} ngày trước — chưa gia hạn`
    }
    if (item.reason === 'trial_missing') {
        return 'Đã nhập thực thu nhưng chưa được tính trial — đang dùng miễn phí'
    }
    if (item.reason === 'dormant') {
        return item.last_active_at
            ? `Im lặng ${daysSince(item.last_active_at)} ngày — gần như chắc đã bỏ`
            : 'Chưa từng hoạt động, đã trả phí lâu'
    }
    return `Mã SP${item.reference} · ${fmtDT(item.intent_created_at)}`
}

function itemKey(item: AttentionItem) {
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

    const [data, setData] = useState<Overview | null>(null)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [confirmId, setConfirmId] = useState<string | null>(null) // 2-step confirm cho "Cấp gói tay"
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(() => {
        fetchAdminDashboard()
            .then(setData)
            .catch((e) => setError(errorMessage(e, '')))
    }, [])

    useEffect(() => {
        if (isAdmin) reload()
    }, [isAdmin, reload])

    const payments = data?.payment_issues ?? []
    const branches = data?.attention ?? []
    const items = data ? [...payments, ...branches] : null
    const dormant = data?.dormant_addresses ?? []
    const totalCount = data?.attention_total_count ?? branches.length // đếm thật chi nhánh (đã dedupe), branches chỉ là top-20 hiển thị
    const dormantCount = data?.dormant_count ?? 0
    const countHint = items ? (totalCount > branches.length ? `${items.length}/${totalCount + payments.length} mục` : `${items.length} mục`) : undefined

    if (authLoading) return null
    if (!isAdmin) return <Navigate to="/addresses" />

    // grant=true: giao dịch → Cấp gói (2 bước xác nhận) / chi nhánh trial_missing → Cấp trial 7 ngày (2 bước).
    // grant=false: Bỏ qua — giao dịch thì đóng intent, trial_missing thì chỉ ẩn khỏi danh sách (trigger vẫn cấp
    // trial bình thường nếu họ chốt thực thu đủ điều kiện sau này).
    const handleAction = async (item: AttentionItem, grant: boolean) => {
        const key = itemKey(item)
        if (grant && confirmId !== key) {
            setConfirmId(key)
            setTimeout(() => setConfirmId((c) => (c === key ? null : c)), 4000)
            return
        }
        setConfirmId(null)
        setBusyId(key)
        setError(null)
        try {
            if (item.intent_id) await resolvePaymentIntent(item.intent_id, grant)
            else if (grant) await grantSubscription([item.address_id!], [ALL_TIER], 1, 0, 'trial')
            else await dismissAttention(item.address_id!, item.reason)
            setData((d) => d && (item.intent_id
                ? { ...d, payment_issues: (d.payment_issues ?? []).filter((i) => i.intent_id !== item.intent_id) }
                : { ...d, attention: d.attention.filter((i) => itemKey(i) !== key), attention_total_count: Math.max(0, totalCount - 1) }))
        } catch (e) {
            setError(errorMessage(e, ''))
        } finally {
            setBusyId(null)
        }
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            <AdminPageHeader title="Cần chú ý" subtitle={countHint} onBack={() => navigate('/admin/dashboard')} onRefresh={reload} />

            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 flex flex-col gap-5">
                {error && (
                    <p className="text-[12px] font-bold text-red-500 bg-red-500/10 border border-red-500/20 rounded-[12px] px-3 py-2">
                        Lỗi: {error}
                    </p>
                )}

                {/* ── Cần chú ý ─────────────────────────────────────────────── */}
                <section className="flex flex-col gap-2.5">
                    {items === null ? (
                        <Loader2 size={20} className="animate-spin text-text-dim mx-auto my-4" />
                    ) : items.length === 0 ? (
                        <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-4 text-center">
                            <p className="text-[12px] text-text-secondary font-medium">Không có chi nhánh nào cần xử lý.</p>
                        </div>
                    ) : (
                        items.map((it) => {
                            const key = itemKey(it)
                            return (
                                <AttentionItemCard
                                    key={key}
                                    item={it}
                                    busy={busyId === key}
                                    confirming={confirmId === key}
                                    onGrant={() => handleAction(it, true)}
                                    onDismiss={() => handleAction(it, false)}
                                />
                            )
                        })
                    )}
                </section>

                {/* v5: im lặng >90 ngày — tách khỏi KPI, chỉ để tham khảo/gọi lại nếu rảnh */}
                {dormant.length > 0 && (
                    <section className="flex flex-col gap-2.5">
                        <SectionHeader
                            icon={<AlertTriangle size={14} className="text-text-dim" />}
                            title="Đã bỏ, không tính KPI"
                            hint={`${dormant.length}${dormantCount > dormant.length ? `/${dormantCount}` : ''} chi nhánh · im lặng >90 ngày`}
                        />
                        {dormant.map((it) => (
                            <AttentionItemCard key={itemKey(it)} item={it} />
                        ))}
                    </section>
                )}
            </div>
        </div>
    )
}

function AttentionItemCard({ item, busy, confirming, onGrant, onDismiss }: { item: AttentionItem; busy?: boolean; confirming?: boolean; onGrant?: () => void; onDismiss?: () => void }) {
    const isPayment = item.reason === 'payment_review' || item.reason === 'payment_stale'
    const hasActions = isPayment || (item.reason === 'trial_missing' && !!onGrant)
    const tagLabel = item.reason === 'payment_stale' ? `Pending ${elapsedMinutes(item.intent_created_at)}'` : REASON[item.reason].label
    const call = item.owner_phone ? (
        <a
            href={`tel:${item.owner_phone}`}
            className={`py-2 rounded-[10px] text-[11px] font-bold text-center bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.98] transition-all ${hasActions ? 'px-3' : 'flex-1'}`}
        >
            Gọi {item.owner_name ? item.owner_name.split(' ').slice(-1)[0] : 'chủ quán'}
        </a>
    ) : hasActions ? null : (
        <span className="flex-1 py-2 text-[11px] text-text-dim text-center">Không có SĐT liên hệ</span>
    )

    return (
        <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-text truncate">
                    {item.name}
                    {(item.branch_extra ?? 0) > 0 && <span className="text-text-dim font-medium"> +{item.branch_extra} khác</span>}
                </span>
                <span className={`shrink-0 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full ${REASON[item.reason].cls}`}>
                    {tagLabel}
                </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                <span>{attentionDetail(item)}</span>
                {isPayment && <span className="font-black text-text shrink-0">{formatVND(item.amount ?? 0)}</span>}
            </div>
            <div className="flex gap-2 pt-1">
                {!isPayment && call}
                {hasActions && (
                    <>
                        <button
                            onClick={onGrant}
                            disabled={busy}
                            className={`flex-1 py-2 rounded-[10px] text-[11px] font-bold active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5
                                ${confirming ? 'bg-success/20 text-success' : 'bg-success-soft/60 text-success hover:bg-success/20'}`}
                        >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : confirming ? 'Bấm lần nữa để cấp' : isPayment ? 'Đã nhận tiền — Cấp gói' : 'Cấp trial 7 ngày'}
                        </button>
                        <button
                            onClick={onDismiss}
                            disabled={busy}
                            className="px-3 py-2 rounded-[10px] text-[11px] font-bold bg-surface-light text-text-secondary hover:bg-border/40 active:scale-[0.98] transition-all disabled:opacity-50"
                        >
                            Bỏ qua
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

function SectionHeader({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
    return (
        <div className="flex items-center gap-2 px-0.5">
            {icon}
            <p className="text-[12px] font-black text-text uppercase tracking-wider">{title}</p>
            {hint && <span className="text-[10px] text-text-dim normal-case font-medium">{hint}</span>}
        </div>
    )
}
