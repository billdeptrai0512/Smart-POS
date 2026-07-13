import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { formatVND } from '../utils/money'
import { fetchAdminDashboard } from '../services/adminDashboardService'

const MONTH_LABELS = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12']
const REASON_LABEL = { expiring: 'Sắp hết hạn', inactive: 'Không hoạt động', payment_review: 'Thanh toán treo' }
const REASON_TAG_CLASS = {
    expiring: 'bg-warning-soft text-warning',
    inactive: 'bg-danger-soft text-danger',
    payment_review: 'bg-danger/20 text-danger',
}
const ACTIVITY_ICON = {
    payment: { bg: 'bg-success-soft', color: 'text-success', symbol: '₫' },
    new_branch: { bg: 'bg-primary/10', color: 'text-primary', symbol: '+' },
    referral: { bg: 'bg-warning-soft', color: 'text-warning', symbol: '🎁' },
    review: { bg: 'bg-danger-soft', color: 'text-danger', symbol: '!' },
}

function monthLabel(ym) {
    const m = Number(ym.slice(5, 7))
    return MONTH_LABELS[m - 1] || ym
}

function daysLeft(dateStr) {
    return Math.ceil((new Date(dateStr) - Date.now()) / 86_400_000)
}

function lastActiveLabel(iso) {
    if (!iso) return 'Chưa có hoạt động'
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
    if (d <= 0) return 'Hôm nay'
    if (d === 1) return 'Hôm qua'
    return `${d} ngày trước`
}

function activityAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (minutes < 1) return 'Vừa xong'
    if (minutes < 60) return `${minutes} phút trước`
    if (minutes < 1440) return `${Math.floor(minutes / 60)} giờ trước`
    const days = Math.floor(minutes / 1440)
    return days === 1 ? 'Hôm qua' : `${days} ngày trước`
}

function attentionDetail(item) {
    if (item.reason === 'expiring') {
        const d = daysLeft(item.valid_to)
        return d <= 0 ? 'Hết hạn hôm nay' : `Hết hạn ${d} ngày nữa`
    }
    if (item.reason === 'inactive') {
        return item.last_active_at ? `Không hoạt động ${Math.floor((Date.now() - new Date(item.last_active_at).getTime()) / 86_400_000)} ngày` : 'Chưa từng hoạt động'
    }
    if (item.reason === 'payment_review') {
        return `${item.reference ? 'SP' + item.reference : 'Giao dịch'} · ${formatVND(item.amount || 0)}`
    }
    return ''
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
        <div className="min-h-[100dvh] bg-bg">
            <header className="sticky top-0 z-20 bg-surface border-b border-border/60 shadow-sm px-4 py-3 xl:px-8 flex items-center gap-3">
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
    )
}

function DashboardBody({ data, navigate }) {
    const { revenue, subscription, attention, activity } = data
    const growthPct = revenue.last_month > 0 ? Math.round(((revenue.this_month - revenue.last_month) / revenue.last_month) * 100) : null
    const reviewCount = attention.filter((a) => a.reason === 'payment_review').length

    return (
        <>
            <KpiRow revenue={revenue} subscription={subscription} attentionCount={attention.length} reviewCount={reviewCount} growthPct={growthPct} />
            <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[1fr_320px] xl:items-start">
                <div className="flex flex-col gap-4 min-w-0">
                    <RevenueCard revenue={revenue} />
                    <SubscriptionHealthCard subscription={subscription} />
                    <AttentionCard items={attention} navigate={navigate} />
                </div>
                <ActivityCard items={activity} className="xl:sticky xl:top-[88px]" />
            </div>
        </>
    )
}

function KpiCard({ stripe, label, value, delta, deltaClass }) {
    return (
        <div className="relative bg-surface border border-border/60 rounded-[16px] pl-4 pr-3.5 py-3.5 overflow-hidden">
            <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${stripe}`} />
            <p className="text-[10px] font-black uppercase tracking-wide text-text-dim mb-1">{label}</p>
            <p className="text-[19px] xl:text-[22px] font-black text-text tabular-nums leading-tight truncate">{value}</p>
            {delta && <p className={`text-[11px] font-bold mt-1 truncate ${deltaClass}`}>{delta}</p>}
        </div>
    )
}

function KpiRow({ revenue, subscription, attentionCount, reviewCount, growthPct }) {
    return (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <KpiCard
                stripe="bg-primary"
                label="Doanh thu tháng này"
                value={formatVND(revenue.this_month)}
                delta={growthPct === null ? 'Chưa có dữ liệu tháng trước' : `${growthPct >= 0 ? '▲' : '▼'} ${Math.abs(growthPct)}% so với tháng trước`}
                deltaClass={growthPct === null ? 'text-text-dim' : growthPct >= 0 ? 'text-success' : 'text-danger'}
            />
            <KpiCard
                stripe="bg-success"
                label="Đang trả phí"
                value={`${subscription.paid_count} chi nhánh`}
                delta={`${subscription.trial_count} đang dùng thử`}
                deltaClass="text-text-secondary"
            />
            <KpiCard
                stripe="bg-warning"
                label="Sắp hết hạn (≤7 ngày)"
                value={`${subscription.expiring_soon_count} chi nhánh`}
                delta={subscription.expiring_soon_count > 0 ? 'Cần thu phí sớm' : 'Không có'}
                deltaClass={subscription.expiring_soon_count > 0 ? 'text-warning' : 'text-text-dim'}
            />
            <KpiCard
                stripe="bg-danger"
                label="Cần chú ý"
                value={`${attentionCount} chi nhánh`}
                delta={reviewCount > 0 ? `${reviewCount} thanh toán treo` : attentionCount > 0 ? 'Xem danh sách bên dưới' : 'Đang ổn'}
                deltaClass={reviewCount > 0 ? 'text-danger' : attentionCount > 0 ? 'text-warning' : 'text-text-dim'}
            />
        </div>
    )
}

function RevenueTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    const amount = payload[0].payload.amount
    if (!amount) return null
    return (
        <div className="bg-surface border border-border-light rounded-[12px] px-3 py-2 shadow-xl">
            <div className="text-[11px] font-black text-primary uppercase mb-1">{label}</div>
            <div className="text-[12px] text-text font-bold">{formatVND(amount)}</div>
        </div>
    )
}

function RevenueCard({ revenue }) {
    const chartData = revenue.monthly_series.map((m) => ({ label: monthLabel(m.month), amount: m.amount }))

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary">Doanh thu theo tháng</h3>
            <p className="text-[11px] text-text-dim mb-3">Tiền thật đã thu (6 tháng gần nhất)</p>
            <div className="h-[140px] w-full [&_*]:outline-none [&_*]:focus:outline-none">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} barCategoryGap="28%" margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#7d9bb0', fontWeight: 700 }} axisLine={false} tickLine={false} tickMargin={6} />
                        <Tooltip content={<RevenueTooltip />} cursor={false} />
                        <Bar dataKey="amount" fill="#f4774b" radius={[6, 6, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
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
                <StatRow dotClass="bg-success" label="Đang trả phí" value={paid_count} />
                <StatRow dotClass="bg-warning" label="Dùng thử" value={trial_count} />
                <StatRow dotClass="bg-border-light" label="Hết hạn / đã rời bỏ" value={churned_count} />
                <StatRow label="Mới trả phí trong tháng" value={`+${new_paid_this_month}`} />
            </div>
        </div>
    )
}

function ContactAction({ item, navigate }) {
    if (item.reason === 'payment_review') {
        return (
            <button
                onClick={() => navigate('/admin/reconciliation')}
                className="text-[10.5px] font-black text-primary bg-primary/10 rounded-[7px] px-2.5 py-1 hover:bg-primary/20 transition-colors shrink-0"
            >
                Xem đối soát
            </button>
        )
    }
    if (!item.owner_phone) return <span className="text-[10.5px] text-text-dim shrink-0">—</span>
    return (
        <a
            href={`tel:${item.owner_phone}`}
            className="text-[10.5px] font-black text-primary bg-primary/10 rounded-[7px] px-2.5 py-1 hover:bg-primary/20 transition-colors shrink-0"
        >
            Gọi {item.owner_name ? item.owner_name.split(' ').slice(-1)[0] : 'chủ quán'}
        </a>
    )
}

function AttentionCard({ items, navigate }) {
    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary">Cần chú ý</h3>
                <span className="text-[11px] text-text-dim font-bold">{items.length} chi nhánh</span>
            </div>
            {items.length === 0 ? (
                <p className="text-[12px] text-text-secondary py-4 text-center">Không có chi nhánh nào cần chú ý.</p>
            ) : (
                <>
                    <div className="hidden md:block overflow-x-auto mt-3">
                        <table className="w-full text-[12px]">
                            <thead>
                                <tr className="text-left text-[10px] uppercase text-text-dim">
                                    <th className="pb-2 font-black">Chi nhánh</th>
                                    <th className="pb-2 font-black">Lý do</th>
                                    <th className="pb-2 font-black">Hoạt động cuối</th>
                                    <th className="pb-2 font-black"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item, i) => (
                                    <tr key={i} className="border-t border-border/60">
                                        <td className="py-2.5 font-bold text-text">{item.name}</td>
                                        <td className="py-2.5">
                                            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${REASON_TAG_CLASS[item.reason]}`}>
                                                {REASON_LABEL[item.reason]}
                                            </span>
                                            <span className="ml-2 text-text-secondary">{attentionDetail(item)}</span>
                                        </td>
                                        <td className="py-2.5 text-text-secondary">{item.reason === 'payment_review' ? '—' : lastActiveLabel(item.last_active_at)}</td>
                                        <td className="py-2.5 text-right">
                                            <ContactAction item={item} navigate={navigate} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="md:hidden flex flex-col gap-2 mt-3">
                        {items.map((item, i) => (
                            <div key={i} className="rounded-[14px] border border-border/60 bg-surface-light px-3 py-2.5 flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[12.5px] font-black text-text truncate">{item.name}</span>
                                    <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full ${REASON_TAG_CLASS[item.reason]}`}>
                                        {REASON_LABEL[item.reason]}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                                    <span className="truncate">{attentionDetail(item)}</span>
                                    <ContactAction item={item} navigate={navigate} />
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

function ActivityCard({ items, className = '' }) {
    return (
        <div className={`bg-surface border border-border/60 rounded-[20px] p-4 ${className}`}>
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
