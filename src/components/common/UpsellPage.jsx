import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, TrendingUp, ShieldCheck, ArrowLeft, Loader2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { supabase } from '../../lib/supabaseClient'

/**
 * UpsellPage — Full-screen gate khi tier === null
 * Bán duy nhất gói Basic (Báo cáo)
 *
 * Props:
 *   required: 'basic' | 'pro'
 *   backTo:   path để nút Back navigate về (default: '/history')
 */
export default function UpsellPage({ required = 'basic', backTo = '/history' }) {
    const navigate = useNavigate()
    const { isAdmin } = useAuth()
    const { selectedAddress } = useAddress()
    const [isMocking, setIsMocking] = useState(false)

    const handleMockPayment = async () => {
        if (!selectedAddress?.id) return
        setIsMocking(true)
        try {
            const { error } = await supabase.from('address_subscriptions').insert({
                address_id: selectedAddress.id,
                tier: 'basic',
                valid_from: new Date().toISOString().split('T')[0],
                valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                amount_paid: 88888,
                note: 'admin_mock'
            })
            if (error) throw error
            alert('Mock thanh toán Basic thành công!')
            window.location.reload()
        } catch (err) {
            alert('Lỗi: ' + err.message)
            setIsMocking(false)
        }
    }

    const features = [
        { icon: TrendingUp, text: 'Báo cáo doanh thu & P&L' },
        { icon: TrendingUp, text: 'Biểu đồ hiệu suất theo ngày' },
        { icon: ShieldCheck, text: 'Gợi ý đi chợ (Refill tab)' },
        { icon: ShieldCheck, text: 'Báo cáo kỳ (tuần / tháng)' },
    ]

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative overflow-hidden">
            {/* Ambient glow */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(245,158,11,0.12), transparent)',
                }}
            />

            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-4 pt-5 pb-4">
                <button
                    id="upsell-back-btn"
                    onClick={() => navigate(backTo)}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text active:scale-95 transition-all"
                >
                    <ArrowLeft size={16} />
                </button>
                <span className="text-[13px] font-bold text-text-secondary uppercase tracking-widest">
                    Nâng cấp
                </span>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 pb-32">
                {/* Lock badge */}
                <div className="flex flex-col items-center pt-6 pb-8 text-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-5 shadow-[0_0_30px_rgba(245,158,11,0.15)]">
                        <Lock size={28} className="text-primary" />
                    </div>
                    <h1 className="text-[22px] font-black text-text mb-2 leading-tight">
                        Tính năng Báo cáo
                    </h1>
                    <p className="text-[14px] text-text-secondary leading-relaxed max-w-[280px]">
                        Mở khoá Gói Basic để quản lý dòng tiền và lợi nhuận hiệu quả hơn — chỉ với 88,888đ/tháng.
                    </p>
                </div>

                {/* Feature list */}
                <div className="bg-surface rounded-[20px] border border-border/60 p-4 mb-4">
                    <p className="text-[11px] font-black text-text-secondary uppercase tracking-widest mb-3">
                        Gói Basic Bao gồm
                    </p>
                    <div className="flex flex-col gap-3">
                        {features.map(({ icon: Icon, text }, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                    <Icon size={13} className="text-primary" />
                                </div>
                                <span className="text-[14px] font-medium text-text">{text}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* POS guarantee */}
                <div className="bg-success/5 border border-success/15 rounded-[16px] p-3.5 flex items-start gap-3">
                    <ShieldCheck size={16} className="text-success mt-0.5 shrink-0" />
                    <p className="text-[12px] text-success/90 leading-relaxed">
                        <span className="font-black">POS & chốt ca luôn hoạt động</span> — kể cả khi chưa đăng ký, quán vẫn bán hàng bình thường.
                    </p>
                </div>
            </div>

            {/* CTA Footer */}
            <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto p-4 bg-bg/90 backdrop-blur-sm border-t border-border/40 pointer-events-auto z-20">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <p className="text-[11px] text-text-secondary font-medium">Gói Basic (Báo cáo)</p>
                        <p className="text-[18px] font-black text-primary">
                            88,888đ<span className="text-[11px] text-text-secondary font-medium ml-1">/địa chỉ/tháng</span>
                        </p>
                    </div>
                    <div className="text-right">
                        <p className="text-[11px] text-text-secondary">Dùng thử</p>
                        <p className="text-[13px] font-black text-text">3 ngày miễn phí</p>
                    </div>
                </div>
                <button
                    id="upsell-cta-btn"
                    className="w-full py-3.5 rounded-[14px] bg-primary text-bg text-[15px] font-black hover:bg-primary/90 active:scale-[0.98] transition-all shadow-[0_4px_20px_rgba(245,158,11,0.3)]"
                    onClick={() => {
                        alert('Tính năng thanh toán sẽ sớm ra mắt!')
                    }}
                >
                    Đăng ký Gói Basic — 88,888đ
                </button>
                {isAdmin && (
                    <button
                        onClick={handleMockPayment}
                        disabled={isMocking}
                        className="w-full mt-2 py-2.5 rounded-[12px] bg-red-500/10 text-red-500 text-[13px] font-bold hover:bg-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        {isMocking ? <Loader2 size={16} className="animate-spin" /> : 'Mock Mua Basic (Admin Only)'}
                    </button>
                )}
                <p className="text-center text-[11px] text-text-dim mt-2">
                    Thanh toán qua chuyển khoản ngân hàng · Không tự gia hạn
                </p>
            </div>
        </div>
    )
}
