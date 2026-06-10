import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import SubscriptionPanel from './SubscriptionPanel'

/**
 * SubscriptionScreen — trang đăng ký gói full-screen DÙNG CHUNG.
 * Header form giống /history: nút back bo góc trái + chip tiêu đề canh giữa.
 * 1 gói duy nhất (888,888đ / 6 tháng) → không còn chọn chu kỳ.
 *
 * Một UI duy nhất cho mọi luồng:
 *   - Route /subscription (từ SubscriptionBadge) → backTo = /addresses
 *   - View báo cáo bị khoá (DailyReportPage early-return) → backTo = /pos
 *
 * Props: backTo, preselectAddressId, onDone
 */
export default function SubscriptionScreen({ backTo = '/addresses', preselectAddressId, onDone }) {
    const navigate = useNavigate()

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            {/* Header: [back] [chip tiêu đề canh giữa] */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
                <button
                    onClick={() => navigate(backTo)}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 min-w-0 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-3 py-2.5 flex items-center justify-center">
                    <span className="text-[12px] font-black text-primary uppercase tracking-wide">Đăng ký sử dụng</span>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 pt-4">
                <SubscriptionPanel
                    preselectAddressId={preselectAddressId}
                    onDone={onDone || (() => navigate(backTo))}
                />
            </div>
        </div>
    )
}
