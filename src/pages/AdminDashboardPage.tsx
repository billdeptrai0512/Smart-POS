import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchAdminDashboard, fetchAdminBranchStages } from '../services/adminDashboardService'
import { fetchGuestOnboardingFunnel, fetchLoginPageVisits } from '../services/onboardingFunnelService'
import { timeStringVN } from '../utils/dateVN'
import MonetizationToggle from '../components/AdminDashboardPage/MonetizationToggle'
import { errorMessage } from '../utils/errorMessage'
import AdminPageHeader from '../components/common/AdminPageHeader'

// Hình dạng JSON của RPC admin_dashboard_overview / guest_onboarding_funnel_stats
// (supabase.rpc không có type) — chỉ khai các trường trang này đọc.
interface ActivityItem { type: string; address_name: string; detail: string; at: string }
interface DashboardData {
    generated_at: string
    attention: { reason: string }[]
    activity: ActivityItem[]
    attention_total_count?: number
}
interface FunnelStage { stage: number; label: string; count: number; step_median_seconds?: number | null }
interface GuestFunnel {
    stages: FunnelStage[]
    signup: { after_complete: number; early: number }
    prev?: { entered: number; signed_up: number } | null
}
type Delta = { text: string; cls: string }

const CARD = 'bg-surface border border-border/60 rounded-[20px] p-4'
const CARD_TITLE = 'text-[12px] font-black uppercase tracking-wide text-text-secondary'

// v3: chỉ còn 3 loại activity actionable (payment/review/rating) — xem
// 20260815_admin_dashboard_overview_v3.sql, đã bỏ new_branch/referral/new_account/new_staff.
// v7: +deletion — "Xóa địa chỉ" giờ soft-delete, không còn biến mất im lặng
// (xem 20260824_admin_dashboard_overview_v7.sql).
const ACTIVITY_ICON: Record<string, { bg: string; color: string; symbol: string }> = {
    payment: { bg: 'bg-success-soft', color: 'text-success', symbol: '₫' },
    review: { bg: 'bg-danger-soft', color: 'text-danger', symbol: '!' },
    rating: { bg: 'bg-warning-soft', color: 'text-warning', symbol: '★' },
    deletion: { bg: 'bg-danger-soft', color: 'text-danger', symbol: '🗑' },
}

// Bước trong guide onboarding tầm giây (bấm tạo đơn, mở nhật ký...) — làm tròn
// phút thì mọi bước hiện "0′" như nhau, mất hết tín hiệu bước nào chậm hơn.
// Dưới 1 phút giữ nguyên giây; từ 1 phút trở lên mới quy tròn ra phút (bước
// chậm, kiểu cài công thức/nguyên liệu, không cần chính xác tới giây).
function formatStepDuration(seconds?: number | null) {
    if (seconds == null) return null
    return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}′`
}

function delta(diff: number, unit: string, period: string, noChange: string): Delta {
    if (diff === 0) return { text: noChange, cls: 'text-text-dim' }
    return {
        text: `${diff > 0 ? '+' : ''}${diff}${unit} so với ${period}`,
        cls: diff > 0 ? 'text-success' : 'text-danger',
    }
}

// So tỷ lệ chuyển đổi (dùng thử → đăng ký) với đúng kỳ liền trước (hôm qua/tuần
// trước) — trả lời "sửa guide có thật sự giúp không" thay vì chỉ nhìn 1 ảnh chụp.
const pctDelta = (currentPct: number, prevPct: number) => delta(currentPct - prevPct, '%', 'kỳ trước', 'không đổi so với kỳ trước')

function activityAgo(iso: string) {
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
    const [data, setData] = useState<DashboardData | null>(null)
    const [error, setError] = useState<string | null>(null)
    // Phễu guest (byRange: 1 lần gọi trả cả today/week/all) và giai đoạn chi nhánh fetch song song với overview.
    // Hai RPC này lỗi/chưa apply → null → ẩn hẳn thẻ, không hỏng phần còn lại của dashboard.
    const [byRange, setByRange] = useState<Record<string, GuestFunnel> | null>(null)
    const [stages, setStages] = useState<Record<string, number> | null>(null)
    const [visits, setVisits] = useState<Record<string, number> | null>(null)

    const reload = useCallback(() => {
        fetchAdminDashboard().then(setData).catch((e) => setError(errorMessage(e, '')))
        fetchGuestOnboardingFunnel().then(setByRange).catch(() => setByRange(null))
        fetchAdminBranchStages().then(setStages).catch(() => setStages(null))
        fetchLoginPageVisits().then(setVisits).catch(() => setVisits(null))
    }, [])

    useEffect(() => {
        if (isAdmin) reload()
    }, [isAdmin, reload])

    if (authLoading) return null
    if (!isAdmin) return <Navigate to="/addresses" />

    return (
        <div className="flex flex-col h-[100dvh] bg-bg">
            <AdminPageHeader
                title="Admin Dashboard"
                subtitle={data ? `Cập nhật ${timeStringVN(new Date(data.generated_at))}` : undefined}
                onBack={() => navigate('/addresses')}
                onRefresh={reload}
            />

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
                        <DashboardBody data={data} byRange={byRange} stages={stages} visits={visits} />
                    )}
                </div>
            </div>
        </div>
    )
}

function DashboardBody({ data, byRange, stages, visits }: { data: DashboardData; byRange: Record<string, GuestFunnel> | null; stages: Record<string, number> | null; visits: Record<string, number> | null }) {
    const { attention, activity, attention_total_count } = data
    // total_count = đếm không giới hạn (đã dedupe theo chi nhánh) từ RPC; attention (mảng) chỉ là top-20
    // hiển thị nên KHÔNG dùng .length làm KPI — sẽ undercount khi > 20 chi nhánh cần chú ý.
    const attentionCount = attention_total_count ?? attention.length
    return (
        <>
            <ActiveTodayHeroCard stages={stages} />
            <KpiRow stages={stages} attentionCount={attentionCount} />
            {/* Tổng 16 chi nhánh chia theo giai đoạn — đứng ngay dưới con số tổng. */}
            {stages && (
                <div className="mb-4">
                    <BranchStageCard stages={stages} />
                </div>
            )}
            <div className="flex flex-col gap-4">
                <OnboardingFunnelCard byRange={byRange} visits={visits} />
                <ActivityCard items={activity} />
            </div>
            {/* Công tắc cấu hình, không phải số liệu — xuống cuối, đứng đầu trang chỉ
                chiếm chỗ của câu mở đầu. */}
            <div className="mt-4">
                <MonetizationToggle />
            </div>
        </>
    )
}

// OMTM: số chi nhánh có đơn/ca HÔM NAY (admin_branch_stages.active_today) — mức dùng thật, đủ mẫu và
// phản hồi trong ngày; chuyển đổi trả phí/kích hoạt chỉ là bối cảnh ở các thẻ bên dưới.
function ActiveTodayHeroCard({ stages }: { stages: Record<string, number> | null }) {
    return (
        <div className="relative bg-success-soft border border-success/30 rounded-[20px] px-5 py-4 mb-3 overflow-hidden">
            <p className="text-[10.5px] font-black uppercase tracking-wide text-success">Hôm nay hoạt động</p>
            <p className="text-[34px] font-black tabular-nums leading-tight mt-0.5 text-text">
                {stages ? stages.active_today : '—'}
                {stages && <span className="text-[14px] font-bold text-text-secondary ml-1.5">chi nhánh</span>}
                {stages?.active_yesterday != null && <span className="text-[12px] font-bold text-text-dim ml-3">hôm qua {stages.active_yesterday}</span>}
            </p>
        </div>
    )
}

function KpiCard({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
    const Tag = onClick ? 'button' : 'div'
    return (
        <Tag
            onClick={onClick}
            className={`relative bg-surface border border-border/60 rounded-[16px] px-4 py-3.5 overflow-hidden text-left ${onClick ? 'hover:bg-border/10 active:scale-[0.99] transition-all' : ''}`}
        >
            <p className="text-[10px] font-black uppercase tracking-wide text-text-dim mb-1">{label}</p>
            <p className="text-[19px] xl:text-[22px] font-black text-text tabular-nums leading-tight truncate">{value}</p>
        </Tag>
    )
}

function KpiRow({ stages, attentionCount }: { stages: Record<string, number> | null; attentionCount: number }) {
    const navigate = useNavigate()
    const total = stages ? BRANCH_STAGES.reduce((n, s) => n + (stages[s.key] ?? 0), 0) : null

    return (
        <div className="grid grid-cols-2 gap-3 mb-4">
            <KpiCard label="Tổng cộng có" value={total != null ? `${total} chi nhánh` : '—'} />
            <KpiCard
                label="Cần chú ý"
                value={`${attentionCount} chi nhánh`}
                onClick={() => navigate('/admin/reconciliation')}
            />
        </div>
    )
}

function StatRow({ dotClass, label, value, onClick }: { dotClass?: string; label: string; value: ReactNode; onClick?: () => void }) {
    const Tag = onClick ? 'button' : 'div'
    return (
        <Tag
            onClick={onClick}
            className={`flex items-center justify-between text-[12.5px] w-full ${onClick ? 'text-left hover:opacity-80 active:scale-[0.99] transition-all' : ''}`}
        >
            <span className={`flex items-center gap-2 ${onClick ? 'text-warning font-bold' : 'text-text-secondary'}`}>
                {dotClass && <i className={`w-[7px] h-[7px] rounded-full inline-block ${dotClass}`} />}
                {label}
            </span>
            <span className={`font-black tabular-nums ${onClick ? 'text-warning' : 'text-text'}`}>{value}</span>
        </Tag>
    )
}

const RANGE_TABS = [
    { key: 'today', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'all', label: 'Tất cả' },
]

// Phễu onboarding khách dùng thử — bao nhiêu người vào dùng thử và rơi rụng ở mốc nào
// (xem 20260816_guest_onboarding_funnel_v2.sql + OnboardingGuide.tsx). Đếm theo visitor_id
// ẩn danh do client sinh, KHÔNG phải theo địa chỉ (mọi khách dùng chung 1 demo address id).
// Fetch riêng (không qua fetchAdminDashboard) — 1 lần gọi trả cả 3 khoảng thời gian
// (today/week/all), đổi tab KHÔNG cần round-trip mới. byRange = null khi RPC chưa apply
// hoặc lỗi → ẩn hẳn phần guest funnel, không hỏng phần còn lại của dashboard.
function OnboardingFunnelCard({ byRange, visits }: { byRange: Record<string, GuestFunnel> | null; visits: Record<string, number> | null }) {
    const [range, setRange] = useState('week')

    const funnel = byRange?.[range]

    return (
        <div className={CARD}>
            <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-border/60">
                <h3 className={CARD_TITLE}>Onboarding</h3>
                {byRange && (
                    <div className="flex gap-0.5 shrink-0 p-0.5 rounded-[10px] bg-surface-light">
                        {RANGE_TABS.map((t) => (
                            <button
                                key={t.key}
                                onClick={() => setRange(t.key)}
                                className={`text-[10px] font-bold px-2.5 py-1 rounded-[8px] transition-colors ${range === t.key ? 'bg-primary text-white' : 'text-text-dim hover:text-text-secondary'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="mt-1">
                {funnel?.stages?.length ? (
                    <GuestFunnelBody funnel={funnel} visits={visits?.[range]} />
                ) : (
                    <p className="text-[11px] text-text-dim">Chưa có khách nào vào dùng thử trong khoảng này</p>
                )}
            </div>
        </div>
    )
}

// Thanh % thay cho chỉ đọc số — nhìn 1 phát ra chỗ thắt cổ chai (thanh nào
// ngắn hẳn so với thanh ngay trên nó) thay vì phải so từng dòng "N (X%)"
// trong đầu. Cùng pattern thanh progress ở ChangeCategorySheet.tsx.
// Nhãn mốc do RPC trả (xem 20261018_guest_onboarding_funnel_five_steps.sql) — đổi chữ ở client
// thay vì viết lại cả hàm SQL chỉ để đổi nhãn hiển thị.
const stageLabel = (raw: string) =>
    raw.replace(/^Xong: /, '').replace('Cài công thức (hết guide)', 'Nhập định lượng')

function FunnelStageRow({ dotClass, label, count, pct, seconds }: { dotClass: string; label: string; count: number; pct: number; seconds?: number | null }) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                    <span className="text-[13px] font-bold text-text">{label}</span>
                    {seconds != null && <span className="text-[10.5px] text-text-dim font-medium ml-2">+{formatStepDuration(seconds)}</span>}
                </span>
                <span className="shrink-0 tabular-nums flex items-baseline gap-1.5">
                    <span className="text-[15px] font-black text-text">{count}</span>
                    <span className="text-[11px] text-text-dim font-bold inline-block w-8 text-right">{pct}%</span>
                </span>
            </div>
            {/* Chỗ rớt tự đọc được từ độ ngắn đi của thanh so với thanh ngay trên — không ghi thêm số. */}
            <div className="h-2 rounded-full bg-surface-light overflow-hidden">
                <div className={`h-full rounded-full ${dotClass} transition-all`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    )
}

function GuestFunnelBody({ funnel, visits }: { funnel: GuestFunnel; visits?: number }) {
    const { stages, signup, prev } = funnel
    const entered = stages[0].count
    // Thanh/% các dòng tính trên số ghé /login khi có; kẹp 100 vì khách cũ bấm hướng dẫn từ trước
    // khi có tracking có thể làm số bấm > số ghé.
    const base = visits ? visits : entered
    const barPct = (n: number) => (base > 0 ? Math.min(100, Math.round((n / base) * 100)) : 0)
    const totalSignup = signup.after_complete + signup.early
    const currentPct = entered > 0 ? Math.round((totalSignup / entered) * 100) : null
    // prev = null cho khoảng "Tất cả" (không có "kỳ trước" tự nhiên) và cho
    // khoảng có prev.entered = 0 (không tính % được, tránh chia 0).
    const prevPct = prev && prev.entered > 0 ? Math.round((prev.signed_up / prev.entered) * 100) : null
    const delta = currentPct != null && prevPct != null ? pctDelta(currentPct, prevPct) : null

    return (
        <>
            {delta && <p className={`text-[11px] font-bold mb-3 ${delta.cls}`}>Đăng ký {delta.text}</p>}
            <div className="flex flex-col gap-3">
                {visits != null && (
                    <FunnelStageRow dotClass="bg-primary" label="Ghé trang đăng nhập" count={visits} pct={visits > 0 ? 100 : 0} />
                )}
                {stages.map((f) => (
                    // step_median_seconds = thời gian trung vị TỪ BƯỚC TRƯỚC tới bước này —
                    // chỗ nào số này to là chỗ khách khựng lại lâu nhất, đáng sửa guide trước.
                    <FunnelStageRow
                        key={f.stage}
                        dotClass={f.stage === 0 ? 'bg-primary' : 'bg-warning'}
                        label={stageLabel(f.label)}
                        count={f.count}
                        pct={barPct(f.count)}
                        seconds={f.step_median_seconds}
                    />
                ))}
                {/* Bước cuối của phễu: đăng ký tài khoản (gồm cả đăng ký sớm, bỏ guide giữa chừng). */}
                <FunnelStageRow
                    dotClass="bg-success"
                    label="Đăng ký tài khoản"
                    count={totalSignup}
                    pct={barPct(totalSignup)}
                />
            </div>
        </>
    )
}

// Phễu chi nhánh theo giai đoạn (admin_branch_stages, migration 20261020): mỗi địa chỉ CÒN SỐNG nằm
// đúng 1 nhóm nên các nhóm cộng lại = tổng địa chỉ; thanh = tỷ lệ trên tổng. RPC riêng như các thẻ
// khác; lỗi/chưa apply → stages = null → ẩn thẻ.
const BRANCH_STAGES = [
    { key: 'never', label: 'Chưa hoạt động', cls: 'bg-text-dim' },
    { key: 'ordered', label: 'Có hoạt động, chưa nhập thực thu', cls: 'bg-warning' },
    { key: 'cash_closed', label: 'Nhập thực thu nhưng chưa bắt đầu trial', cls: 'bg-danger' },
    { key: 'trial', label: 'Đang dùng thử', cls: 'bg-primary' },
    { key: 'paid', label: 'Đã đăng ký', cls: 'bg-success' },
    { key: 'expired', label: 'Hết hạn, chưa gia hạn', cls: 'bg-text-dim' },
] as const

function BranchStageCard({ stages }: { stages: Record<string, number> }) {
    const total = BRANCH_STAGES.reduce((n, s) => n + (stages[s.key] ?? 0), 0)

    return (
        <div className={CARD}>
            <h3 className={`${CARD_TITLE} mb-3 pb-3 border-b border-border/60`}>Trong đó</h3>
            <div className="flex flex-col gap-3">
                {BRANCH_STAGES.map((s) => {
                    const count = stages[s.key] ?? 0
                    return <FunnelStageRow key={s.key} dotClass={s.cls} label={s.label} count={count} pct={total > 0 ? Math.round((count / total) * 100) : 0} />
                })}
            </div>
        </div>
    )
}

function ActivityCard({ items }: { items: ActivityItem[] }) {
    return (
        <div className={CARD}>
            <h3 className={`${CARD_TITLE} mb-3 pb-3 border-b border-border/60`}>Hoạt động gần đây</h3>
            {items.length === 0 ? (
                <p className="text-[12px] text-text-secondary py-2">Chưa có hoạt động nào.</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {items.map((item, i) => {
                        const icon = ACTIVITY_ICON[item.type] || ACTIVITY_ICON.payment
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
