import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { UUID } from '../../types/domain'
import { ArrowLeft, MessageCircleQuestionMark } from 'lucide-react'
import SubscriptionPanel from './SubscriptionPanel'
import SupportModal from './SupportModal'
import { ICON_BTN } from './ModalShell'

/**
 * SubscriptionScreen — trang đăng ký gói full-screen DÙNG CHUNG.
 * Header form giống /history: nút back bo góc trái + chip tiêu đề canh giữa.
 * 1 gói duy nhất (88.888đ / tháng) → không còn chọn chu kỳ.
 *
 * Một UI duy nhất cho mọi luồng:
 *   - Route /subscription (từ SubscriptionBadge) → backTo = /addresses
 *   - View báo cáo bị khoá (DailyReportPage early-return) → backTo = /pos
 *
 * Props: backTo, preselectAddressId, onDone
 */
// notice: dòng nhắc hết hạn đầu trang; onSkip: nút "Bỏ qua" dính đáy (chỉ truyền khi chưa khoá cứng).
interface Props { backTo?: string; preselectAddressId?: UUID; onDone?: () => void; notice?: string; onSkip?: () => void }

export default function SubscriptionScreen({ backTo = '/addresses', preselectAddressId, onDone, notice, onSkip }: Props) {
    const navigate = useNavigate()
    const [showSupport, setShowSupport] = useState(false)

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg">
            {/* Header: [back] [chip tiêu đề canh giữa] [hỗ trợ / liên lạc] */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
                <button
                    onClick={() => navigate(backTo)}
                    className={ICON_BTN}
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 min-w-0 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-3 py-2.5 flex items-center justify-center">
                    <span className="text-[12px] font-black text-primary uppercase tracking-wide">Đăng ký sử dụng</span>
                </div>

                <button onClick={() => setShowSupport(true)} className={ICON_BTN} aria-label="Hỗ trợ / liên lạc">
                    <MessageCircleQuestionMark size={20} strokeWidth={2.5} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto px-4 pt-4">
                {notice && (
                    <p className="mb-4 rounded-[14px] border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] font-bold text-text">{notice}</p>
                )}
                <SubscriptionPanel
                    preselectAddressId={preselectAddressId}
                    onDone={onDone || (() => navigate(backTo))}
                />
            </div>

            {onSkip && (
                <div className="shrink-0 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] border-t border-border/50 bg-bg">
                    <button onClick={onSkip} className="w-full py-2.5 rounded-[12px] bg-surface-light border border-border/60 text-text-secondary text-[13px] font-bold active:scale-[0.98] transition">
                        Bỏ qua
                    </button>
                </div>
            )}

            <SupportModal open={showSupport} onClose={() => setShowSupport(false)} />
        </div>
    )
}
