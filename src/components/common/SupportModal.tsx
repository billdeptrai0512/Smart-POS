import { useState } from 'react'
import { X, Check, Loader2, MessageSquareText } from 'lucide-react'
import zaloImg from '../../assets/zalo.webp'
import facebookImg from '../../assets/facebook.webp'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../hooks/useToast'
import { insertRating } from '../../services/ratingService'
import Toast from '../POSPage/Toast'
import { Dialog } from './ModalShell'

const SUPPORT_LINKS = {
    zalo: 'https://zalo.me/g/yvsgvae1kejljidlxyih',
    facebook: 'https://www.facebook.com/groups/1540591197862324',
}

// 2 nút liên hệ (Facebook / Zalo) — dùng trong modal này và section "Hỗ trợ" của trang đăng ký gói.
export function SupportLinks() {
    return (
        <div className="grid grid-cols-2 gap-3">
            {([[SUPPORT_LINKS.facebook, '#1877f2', facebookImg, 'Facebook'], [SUPPORT_LINKS.zalo, '#0068ff', zaloImg, 'Zalo']] as const).map(([href, color, img, alt]) => (
                // Màu nền 10% / viền 20% bằng hex alpha (1a / 33) — Tailwind không sinh class từ chuỗi ghép động.
                <a key={alt} href={href} target="_blank" rel="noopener noreferrer" style={{ backgroundColor: `${color}1a`, borderColor: `${color}33` }} className="flex items-center justify-center py-4 rounded-[14px] border transition-all active:scale-[0.98]">
                    <img src={img} alt={alt} className="w-9 h-9 rounded-[11px] object-cover shadow-sm" />
                </a>
            ))}
        </div>
    )
}

export default function SupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { profile } = useAuth()
    const { toast, showError } = useToast()
    const [comment, setComment] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [composing, setComposing] = useState(false)

    if (!open) return null

    // Component không bị huỷ khi đóng (chỉ return null) nên state phải tự reset, nếu không mở lại vẫn thấy ô nhập.
    function close() {
        setComposing(false)
        onClose()
    }

    async function handleSubmit() {
        if (!comment.trim() || submitting) return
        setSubmitting(true)
        try {
            await insertRating(profile?.id, comment)
            setSubmitted(true)
        } catch (err) {
            showError(err, 'Gửi góp ý')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <>
        <Dialog
            onClose={close}
            zIndexClass="z-[200]"
            className="px-4"
            panelClassName="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface border border-border/60 rounded-[24px] shadow-2xl p-6 flex flex-col gap-5 animate-scale-up z-10"
        >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">Bạn cần hỗ trợ?</span>
                    <button
                        onClick={close}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                <SupportLinks />

                <div className="h-px bg-border/40" />

                {/* Đánh giá ứng dụng */}
                <div className="flex flex-col gap-3">
                    {submitted ? (
                        <div className="flex items-center gap-2.5 px-4 py-3 rounded-[14px] bg-success/10 border border-success/20 text-success text-[13px] font-bold">
                            <Check size={16} />
                            Cảm ơn bạn đã góp ý!
                        </div>
                    ) : !composing ? (
                        <button
                            type="button"
                            onClick={() => setComposing(true)}
                            className="w-full py-3 rounded-[14px] bg-surface-light border border-border/60 text-text font-black text-[13px] flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                        >
                            <MessageSquareText size={16} />
                            Góp ý cho chúng tôi
                        </button>
                    ) : (
                        <div className="flex flex-col gap-3 origin-top animate-scale-up">
                            <textarea
                                value={comment}
                                onChange={e => setComment(e.target.value)}
                                placeholder="Bạn thấy app thế nào? Cần cải thiện gì?"
                                rows={3}
                                autoFocus
                                className="w-full px-3.5 py-2.5 rounded-[14px] bg-bg border border-border/60 text-text text-[13px] placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary resize-none"
                            />
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={!comment.trim() || submitting}
                                className="w-full py-2.5 rounded-[14px] bg-primary text-black font-black text-[13px] hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {submitting ? <Loader2 size={15} className="animate-spin" /> : 'Gửi góp ý'}
                            </button>
                        </div>
                    )}
                </div>
        </Dialog>
        <Toast toast={toast} />
        </>
    )
}
