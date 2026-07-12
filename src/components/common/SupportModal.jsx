import { useState } from 'react'
import { X, Star, Check, Loader2 } from 'lucide-react'
import zaloImg from '../../assets/zalo.webp'
import facebookImg from '../../assets/facebook.webp'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../hooks/useToast'
import { insertRating } from '../../services/ratingService'

const SUPPORT_LINKS = {
    zalo: 'https://zalo.me/g/yvsgvae1kejljidlxyih',
    facebook: 'https://www.facebook.com/groups/1540591197862324',
}

export default function SupportModal({ open, onClose }) {
    const { profile } = useAuth()
    const { showError } = useToast()
    const [rating, setRating] = useState(0)
    const [hoverRating, setHoverRating] = useState(0)
    const [comment, setComment] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)

    if (!open) return null

    async function handleSubmitRating() {
        if (!rating || submitting) return
        setSubmitting(true)
        try {
            await insertRating(profile?.id, rating, comment)
            setSubmitted(true)
        } catch (err) {
            showError(err, 'Gửi đánh giá')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4" onClick={onClose}>
            {/* Backdrop blur overlay */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" />

            {/* Modal Box */}
            <div
                className="relative w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface border border-border/60 rounded-[24px] shadow-2xl p-6 flex flex-col gap-5 animate-scale-up z-10"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">Bạn cần hỗ trợ?</span>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Options List */}
                <div className="grid grid-cols-2 gap-3">
                    <a
                        href={SUPPORT_LINKS.facebook}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center py-4 rounded-[14px] bg-[#1877f2]/10 hover:bg-[#1877f2]/15 border border-[#1877f2]/20 transition-all active:scale-[0.98]"
                    >
                        <img src={facebookImg} alt="Facebook" className="w-9 h-9 rounded-[11px] object-cover shadow-sm" />
                    </a>

                    <a
                        href={SUPPORT_LINKS.zalo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center py-4 rounded-[14px] bg-[#0068ff]/10 hover:bg-[#0068ff]/15 border border-[#0068ff]/20 transition-all active:scale-[0.98]"
                    >
                        <img src={zaloImg} alt="Zalo" className="w-9 h-9 rounded-[11px] object-cover shadow-sm" />
                    </a>
                </div>

                <div className="h-px bg-border/40" />

                {/* Đánh giá ứng dụng */}
                <div className="flex flex-col gap-3">
                    <p className="text-[10px] font-black uppercase tracking-wider text-text-secondary text-center">Bạn thấy app thế nào?</p>
                    {submitted ? (
                        <div className="flex items-center gap-2.5 px-4 py-3 rounded-[14px] bg-success/10 border border-success/20 text-success text-[13px] font-bold">
                            <Check size={16} />
                            Cảm ơn bạn đã đánh giá!
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-center gap-1.5">
                                {[1, 2, 3, 4, 5].map(n => (
                                    <button
                                        key={n}
                                        type="button"
                                        onClick={() => setRating(n)}
                                        onMouseEnter={() => setHoverRating(n)}
                                        onMouseLeave={() => setHoverRating(0)}
                                        className="p-1 active:scale-90 transition-transform"
                                        aria-label={`${n} sao`}
                                    >
                                        <Star
                                            size={28}
                                            fill={(hoverRating || rating) >= n ? 'currentColor' : 'none'}
                                            className={(hoverRating || rating) >= n ? 'text-warning' : 'text-text-secondary/50'}
                                        />
                                    </button>
                                ))}
                            </div>
                            <textarea
                                value={comment}
                                onChange={e => setComment(e.target.value)}
                                placeholder="Góp ý thêm (không bắt buộc)"
                                rows={3}
                                className="w-full px-3.5 py-2.5 rounded-[14px] bg-bg border border-border/60 text-text text-[13px] placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary resize-none"
                            />
                            <button
                                type="button"
                                onClick={handleSubmitRating}
                                disabled={!rating || submitting}
                                className="w-full py-2.5 rounded-[14px] bg-primary text-black font-black text-[13px] hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {submitting ? <Loader2 size={15} className="animate-spin" /> : 'Gửi đánh giá'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
