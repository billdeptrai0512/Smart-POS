import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchAdminDashboard } from '../services/adminDashboardService'

const ACTIVITY_ICON = {
    payment: { bg: 'bg-success-soft', color: 'text-success', symbol: '₫' },
    new_branch: { bg: 'bg-primary/10', color: 'text-primary', symbol: '+' },
    referral: { bg: 'bg-warning-soft', color: 'text-warning', symbol: '🎁' },
    review: { bg: 'bg-danger-soft', color: 'text-danger', symbol: '!' },
}

function countDelta(current, prev) {
    const diff = current - prev
    if (diff === 0) return { text: 'Không đổi so với tháng trước', cls: 'text-text-dim' }
    return {
        text: `${diff > 0 ? '+' : ''}${diff} so với tháng trước`,
        cls: diff > 0 ? 'text-success' : 'text-danger',
    }
}

function activityAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (minutes < 1) return 'Vừa xong'
    if (minutes < 60) return `${minutes} phút trước`
    if (minutes < 1440) return `${Math.floor(minutes / 60)} giờ trước`
    const days = Math.floor(minutes / 1440)
    return days === 1 ? 'Hôm qua' : `${days} ngày trước`
}

/**
 * AdminDashboardPage — route /admin/dashboard. Tổng quan billing + customer
 * health toàn hệ thống cho admin (chỉ admin, RPC admin_dashboard_overview tự
 * chặn non-admin, đây chỉ là gate UX như AdminReconciliationPage).
 *
 * 1 fetch duy nhất khi mount/refresh — không cache vì chỉ 1 nơi dùng và luôn
 * muốn số mới nhất.
 */
export default function AdminDashboardPage() {
    const navigate = useNavigate()
    const { isAdmin, loading: authLoading } = useAuth()
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    const reload = useCallback(() => {
        fetchAdminDashboard().then(setData).catch((e) => setError(e.message))
    }, [])

    useEffect(() => {
        if (isAdmin) reload()
    }, [isAdmin, reload])

    if (authLoading) return null
    if (!isAdmin) return <Navigate to="/addresses" />

    return (
        <div className="flex flex-col h-[100dvh] bg-bg">
            <header className="shrink-0 bg-surface border-b border-border/60 shadow-sm px-4 py-3 xl:px-8 flex items-center gap-3">
                <button
                    onClick={() => navigate('/addresses')}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shrink-0 focus:outline-none"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="text-[14px] font-black text-text uppercase tracking-wide">Admin Dashboard</h1>
                    {data && (
                        <p className="text-[10.5px] text-text-dim">
                            Cập nhật {new Date(data.generated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    )}
                </div>
                <button
                    onClick={reload}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text-secondary hover:bg-border/40 active:bg-border/60 transition-colors shrink-0 focus:outline-none"
                >
                    <RefreshCw size={16} strokeWidth={2.5} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[1400px] mx-auto px-4 py-5 xl:px-8">
                    {error && (
                        <p className="text-[12px] font-bold text-danger bg-danger-soft rounded-[12px] px-3 py-2 mb-4">Lỗi: {error}</p>
                    )}
                    {!data ? (
                        <div className="flex justify-center py-16">
                            <Loader2 size={24} className="animate-spin text-text-dim" />
                        </div>
                    ) : (
                        <DashboardBody data={data} navigate={navigate} />
                    )}
                </div>
            </div>
        </div>
    )
}

function DashboardBody({ data, navigate }) {
    const { subscription, attention, activity } = data
    const paymentIssueCount = attention.filter((a) => a.reason === 'payment_review' || a.reason === 'payment_stale').length

    return (
        <>
            <KpiRow subscription={subscription} attentionCount={attention.length} paymentIssueCount={paymentIssueCount} navigate={navigate} />
            <div className="flex flex-col gap-4">
                <SubscriptionHealthCard subscription={subscription} />
                <ActivityCard items={activity} />
            </div>
        </>
    )
}

function KpiCard({ stripe, label, value, delta, deltaClass, onClick }) {
    const Tag = onClick ? 'button' : 'div'
    return (
        <Tag
            onClick={onClick}
            className={`relative bg-surface border border-border/60 rounded-[16px] pl-4 pr-3.5 py-3.5 overflow-hidden text-left ${onClick ? 'hover:bg-border/10 active:scale-[0.99] transition-all' : ''}`}
        >
            <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${stripe}`} />
            <p className="text-[10px] font-black uppercase tracking-wide text-text-dim mb-1">{label}</p>
            <p className="text-[19px] xl:text-[22px] font-black text-text tabular-nums leading-tight truncate">{value}</p>
            {delta && <p className={`text-[11px] font-bold mt-1 truncate ${deltaClass}`}>{delta}</p>}
        </Tag>
    )
}

function KpiRow({ subscription, attentionCount, paymentIssueCount, navigate }) {
    const addressesDelta = countDelta(subscription.total_addresses, subscription.total_addresses_prev)
    const paidDelta = countDelta(subscription.paid_count, subscription.paid_count_prev)
    const needsAction = subscription.expiring_soon_count + subscription.trial_count

    return (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <KpiCard
                stripe="bg-primary"
                label="Tổng số địa chỉ"
                value={`${subscription.total_addresses} chi nhánh`}
                delta={addressesDelta.text}
                deltaClass={addressesDelta.cls}
            />
            <KpiCard
                stripe="bg-danger"
                label="Cần chú ý"
                value={`${attentionCount} chi nhánh`}
                delta={paymentIssueCount > 0 ? `${paymentIssueCount} cần đối soát` : attentionCount > 0 ? 'Xem tại đối soát' : 'Đang ổn'}
                deltaClass={paymentIssueCount > 0 ? 'text-danger' : attentionCount > 0 ? 'text-warning' : 'text-text-dim'}
                onClick={() => navigate('/admin/reconciliation')}
            />
            <KpiCard
                stripe="bg-success"
                label="Đã đăng ký"
                value={`${subscription.paid_count} chi nhánh`}
                delta={paidDelta.text}
                deltaClass={paidDelta.cls}
            />
            <KpiCard
                stripe="bg-warning"
                label="Sắp hết hạn (≤7 ngày)"
                value={`${needsAction} chi nhánh`}
                delta={needsAction > 0 ? 'Trả phí hết hạn hoặc dùng thử sắp hết' : 'Không có'}
                deltaClass={needsAction > 0 ? 'text-warning' : 'text-text-dim'}
            />
        </div>
    )
}

function StatRow({ dotClass, label, value }) {
    return (
        <div className="flex items-center justify-between text-[12.5px]">
            <span className="flex items-center gap-2 text-text-secondary">
                {dotClass && <i className={`w-[7px] h-[7px] rounded-full inline-block ${dotClass}`} />}
                {label}
            </span>
            <span className="font-black text-text tabular-nums">{value}</span>
        </div>
    )
}

function SubscriptionHealthCard({ subscription }) {
    const { paid_count, trial_count, churned_count, new_paid_this_month, conversion_rate_30d } = subscription
    const total = paid_count + trial_count + churned_count || 1

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary">Subscription Health</h3>
            <p className="text-[11px] text-text-dim mb-3">
                {conversion_rate_30d != null ? `Chuyển đổi dùng thử → trả phí: ${conversion_rate_30d}% (30 ngày qua)` : 'Chưa đủ dữ liệu chuyển đổi 30 ngày qua'}
            </p>
            <div className="h-2 rounded-full overflow-hidden flex mb-3 bg-surface-light">
                <div className="bg-success" style={{ width: `${(paid_count / total) * 100}%` }} />
                <div className="bg-warning" style={{ width: `${(trial_count / total) * 100}%` }} />
                <div className="bg-border-light" style={{ width: `${(churned_count / total) * 100}%` }} />
            </div>
            <div className="flex flex-col gap-2">
                <StatRow dotClass="bg-success" label="Đã đăng ký" value={paid_count} />
                <StatRow dotClass="bg-warning" label="Dùng thử" value={trial_count} />
                <StatRow dotClass="bg-border-light" label="Hết hạn / đã rời bỏ" value={churned_count} />
                <StatRow label="Mới trả phí trong tháng" value={`+${new_paid_this_month}`} />
            </div>
        </div>
    )
}

function ActivityCard({ items }) {
    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary mb-3">Hoạt động gần đây</h3>
            {items.length === 0 ? (
                <p className="text-[12px] text-text-secondary py-2">Chưa có hoạt động nào.</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {items.map((item, i) => {
                        const icon = ACTIVITY_ICON[item.type] || ACTIVITY_ICON.new_branch
                        return (
                            <div key={i} className="flex items-start gap-2.5">
                                <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center text-[11px] shrink-0 ${icon.bg} ${icon.color}`}>
                                    {icon.symbol}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[12px] text-text-secondary leading-snug">
                                        <b className="text-text font-black">{item.address_name}</b> · {item.detail}
                                    </p>
                                    <p className="text-[10.5px] text-text-dim mt-0.5">{activityAgo(item.at)}</p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
