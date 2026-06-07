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
    { key: 'month', label: 'Tháng' },
    { key: 'year', label: 'Năm' },
]

export default function SubscriptionScreen({ backTo = '/addresses', preselectModule, preselectAddressId, onDone }) {
    const navigate = useNavigate()
    const [period, setPeriod] = useState('month')

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            {/* Header 1 hàng: [back] [chip tiêu đề] [toggle chu kỳ bên phải] */}
            <header className="shrink-0 pt-5 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-2.5">
                <button
                    onClick={() => navigate(backTo)}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <span className="flex-1 min-w-0 text-[15px] font-black text-text truncate">Đăng ký gói</span>

                {/* Toggle chu kỳ — compact, bên phải header */}
                <div className="shrink-0 bg-surface-light border border-border/50 rounded-[12px] flex p-0.5 gap-0.5 shadow-sm">
                    {PERIOD_TABS.map(tab => {
                        const active = period === tab.key
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setPeriod(tab.key)}
                                className={`px-3 py-1.5 rounded-[9px] text-[11px] font-black uppercase tracking-wide transition-all duration-150
                                    ${active ? 'bg-primary text-bg shadow-sm' : 'text-text-secondary hover:text-text'}`}
                            >
                                {tab.label}
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
