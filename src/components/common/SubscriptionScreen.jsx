import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import SubscriptionPanel from './SubscriptionPanel'

/**
 * SubscriptionScreen — trang đăng ký gói full-screen DÙNG CHUNG.
 * Header thiết kế theo style /history (HistoryHeader): nút back bo góc + chip
 * tiêu đề ở giữa + thanh tab bên dưới. **Tab = chu kỳ** (Theo tháng / Theo năm)
 * → period state ở đây, truyền xuống panel (controlled).
 *
 * Một UI duy nhất cho mọi luồng:
 *   - Route /subscription (từ SubscriptionBadge) → backTo = /addresses
 *   - Tab Báo cáo bị khoá (DailyReportPage early-return) → backTo = /pos
 *
 * Props: backTo, preselectModule, preselectAddressId, onDone
 */
const PERIOD_TABS = [
    { key: 'month', label: 'Theo tháng' },
    { key: 'year', label: 'Theo năm' },
]

export default function SubscriptionScreen({ backTo = '/addresses', preselectModule, preselectAddressId, onDone }) {
    const navigate = useNavigate()
    const [period, setPeriod] = useState('month')

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            {/* Header — style đồng bộ với HistoryHeader của /history */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate(backTo)}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex items-center justify-center text-center">
                        <span className="text-[12px] font-black text-primary uppercase line-clamp-1">Đăng ký gói</span>
                    </div>

                    {/* Spacer để chip tiêu đề căn giữa giống /history (back ↔ forward) */}
                    <div className="w-10 h-10 shrink-0" aria-hidden="true" />
                </div>

                {/* Tabs row = chu kỳ thanh toán */}
                <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
                    {PERIOD_TABS.map(tab => {
                        const active = period === tab.key
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setPeriod(tab.key)}
                                className={`flex-1 flex items-center justify-center py-2 rounded-[10px] transition-all duration-200
                                    ${active ? 'bg-primary shadow-sm' : 'hover:bg-border/30'}`}
                            >
                                <span className={`text-[11px] font-black uppercase tracking-wider transition-colors
                                    ${active ? 'text-bg' : 'text-text-secondary'}`}>
                                    {tab.label}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 pt-4">
                <SubscriptionPanel
                    period={period}
                    preselectModule={preselectModule}
                    preselectAddressId={preselectAddressId}
                    onDone={onDone || (() => navigate(backTo))}
                />
            </div>
        </div>
    )
}
