import { useEffect, useRef, useState } from 'react'
import { Lock, Zap, TrendingUp, ShieldCheck, X, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { supabase } from '../../lib/supabaseClient'

/**
 * UpsellSheet — Bottom sheet gate khi tier === 'basic' nhưng feature yêu cầu 'pro'
 * Xuất hiện trong page đang hoạt động, không rời trang.
 *
 * Props:
 *   open:     boolean — hiển thị hay không
 *   onClose:  () => void
 *   required: 'pro' (currently only pro is above basic)
 */
export default function UpsellSheet({ open, onClose, required = 'pro' }) {
    const overlayRef = useRef(null)
    const { isAdmin } = useAuth()
    const { selectedAddress } = useAddress()
    const [isMocking, setIsMocking] = useState(false)

    // Close on backdrop click
    function handleBackdropClick(e) {
        if (e.target === overlayRef.current) onClose()
    }

    // Close on Escape key
    useEffect(() => {
        if (!open) return
        const handleKey = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', handleKey)
        return () => window.removeEventListener('keydown', handleKey)
    }, [open, onClose])

    // Prevent body scroll when open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => { document.body.style.overflow = '' }
    }, [open])

    const handleMockPayment = async () => {
        if (!selectedAddress?.id) return
        setIsMocking(true)
        try {
            const { error } = await supabase.from('address_subscriptions').insert({
                address_id: selectedAddress.id,
                tier: 'pro',
                valid_from: new Date().toISOString().split('T')[0],
                valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                amount_paid: 88888,
                note: 'admin_mock'
            })
            if (error) throw error
            alert('Mock thanh toán Pro thành công!')
            window.location.reload()
        } catch (err) {
            alert('Lỗi: ' + err.message)
            setIsMocking(false)
        }
    }

    if (!open) return null

    const features = [
        { icon: ShieldCheck, text: 'Kiểm kê thất thoát theo kỳ (tuần/tháng)' },
        { icon: TrendingUp, text: 'Phân tích khoảng tồn kho chi tiết' },
        { icon: Zap, text: 'Audit tab nguyên liệu đầy đủ' },
    ]

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={handleBackdropClick}
            id="upsell-sheet-overlay"
        >
            <div
                className="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 animate-slide-up pb-safe"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
            >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                    <div className="w-9 h-1 rounded-full bg-border/60" />
                </div>

                {/* Close */}
                <div className="flex items-center justify-between px-5 pt-2 pb-4">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Lock size={14} className="text-primary" />
                        </div>
                        <div>
                            <p className="text-[15px] font-black text-text">Tính năng Pro</p>
                            <p className="text-[11px] text-text-secondary">Chỉ có trong gói Pro</p>
                        </div>
                    </div>
                    <button
                        id="upsell-sheet-close"
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/50 text-text-secondary hover:text-text active:scale-95 transition-all"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Feature list */}
                <div className="px-5 pb-4">
                    <div className="bg-surface-light rounded-[16px] p-4 mb-4">
                        <div className="flex flex-col gap-3">
                            {features.map(({ icon: Icon, text }, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                        <Icon size={11} className="text-primary" />
                                    </div>
                                    <span className="text-[13px] font-medium text-text">{text}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Pricing */}
                    <div className="flex items-center justify-between mb-4 px-1">
                        <div>
                            <p className="text-[11px] text-text-secondary">Add-on Hao hụt (Pro)</p>
                            <p className="text-[17px] font-black text-primary">
                                88,888đ<span className="text-[11px] text-text-secondary font-medium ml-1">/địa chỉ/tháng</span>
                            </p>
                        </div>
                        <div className="bg-primary/10 border border-primary/20 rounded-[10px] px-3 py-1.5">
                            <p className="text-[11px] font-black text-primary">3 ngày miễn phí</p>
                        </div>
                    </div>

                    {/* CTA */}
                    <button
                        id="upsell-sheet-cta"
                        className="w-full py-3.5 rounded-[14px] bg-primary text-bg text-[15px] font-black hover:bg-primary/90 active:scale-[0.98] transition-all shadow-[0_4px_20px_rgba(245,158,11,0.25)]"
                        onClick={() => {
                            // Phase 3: mở QR payment flow
                            alert('Tính năng thanh toán sẽ sớm ra mắt!')
                        }}
                    >
                        Mua Add-on Hao hụt — 88,888đ/tháng
                    </button>
                    {isAdmin && (
                        <button
                            onClick={handleMockPayment}
                            disabled={isMocking}
                            className="w-full mt-2 py-2.5 rounded-[12px] bg-red-500/10 text-red-500 text-[13px] font-bold hover:bg-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            {isMocking ? <Loader2 size={16} className="animate-spin" /> : 'Mock Mua Pro (Admin Only)'}
                        </button>
                    )}
                    <p className="text-center text-[11px] text-text-dim mt-2">
                        Thanh toán qua chuyển khoản · Không tự gia hạn
                    </p>
                </div>
            </div>
        </div>
    )
}
