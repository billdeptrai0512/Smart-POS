import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRightLeft } from 'lucide-react'
import SubscriptionPanel from './SubscriptionPanel'

/**
 * SubscriptionScreen — trang đăng ký gói full-screen DÙNG CHUNG.
 * Header form giống /history (HistoryHeader): nút back bo góc trái + chip tiêu đề
 * canh giữa + nút bên phải. Nút phải = toggle chu kỳ Tháng/Năm (gộp vào vị trí
 * "next" của history). period state ở đây, truyền xuống panel (controlled).
 *
 * Một UI duy nhất cho mọi luồng:
 *   - Route /subscription (từ SubscriptionBadge) → backTo = /addresses
 *   - Tab Báo cáo bị khoá (DailyReportPage early-return) → backTo = /pos
 *
 * Props: backTo, preselectModule, preselectAddressId, onDone
 */
export default function SubscriptionScreen({ backTo = '/addresses', preselectModule, preselectAddressId, onDone }) {
    const navigate = useNavigate()
    const [period, setPeriod] = useState('month')

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            {/* Header form /history: [back] [chip canh giữa] [toggle chu kỳ = nút phải] */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
                <button
                    onClick={() => navigate(backTo)}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                {/* Pill gộp: tiêu đề "Đăng ký gói" + toggle chu kỳ. Click → đổi Tháng/Năm. */}
                <button
                    onClick={() => setPeriod(period === 'month' ? 'year' : 'month')}
                    title="Đổi chu kỳ tháng / năm"
                    className="flex-1 min-w-0 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-3 py-2.5 flex items-center justify-center gap-2 hover:bg-primary/10 active:scale-[0.99] transition-all focus:outline-none"
                >
                    <span className="shrink-0 flex items-center gap-1.5">
                        <span className="text-[12px] font-black text-primary uppercase tracking-wide">
                            Đăng ký gói {period === 'month' ? 'Tháng' : 'Năm'}
                        </span>
                        <ArrowRightLeft size={13} className="text-text-secondary" strokeWidth={2.5} />
                    </span>
                </button>
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
