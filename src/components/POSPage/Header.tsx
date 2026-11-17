import type { ReactNode } from 'react'
import { onboardingHintClass } from '../../utils/onboardingHint'
import Typewriter from '../common/Typewriter'
import type { LastOrder } from '../../services/cartOps'

interface Props {
    onOpenHistory: () => void
    nav: ReactNode // thanh điều hướng trên cùng (ô địa chỉ)
    recentOrders?: LastOrder[]
    enterKey: string | null
    showOnboardingHint?: boolean
    notice?: ReactNode // dải notice dưới 2 thẻ, vẫn trong header (PrepPinBar)
}

export default function Header({ onOpenHistory, nav, recentOrders = [], enterKey, showOnboardingHint = false, notice }: Props) {
    const hintClass = onboardingHintClass(showOnboardingHint, 'solid')
    // Saved orders only, newest first (max 3). isNew matches only the exact row just
    // committed locally (enterKey) → it slides in and types out; the realtime DB echo,
    // which remounts the row under a new server-timestamp key, can't replay it.
    const rows = recentOrders.slice(0, 3).map(o => ({
        key: o.id ?? o.createdAt, // id is collision-proof; createdAt (ms) can repeat on same-tick commits
        isNew: o.createdAt === enterKey,
        text: o.items.join(' · '),
        time: new Date(o.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    }))
    return (
        <header className="shrink-0 pt-3 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            {/* Thanh điều hướng: ô địa chỉ (đổi tại chỗ). */}
            <div className="px-6 flex items-center gap-2 mb-3">
                {nav}
            </div>
            <div className="px-6 mb-1">
                {/* Nhật ký — trải hết chiều ngang */}
                <div
                    onClick={onOpenHistory}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer bg-bg rounded-[20px] p-3 sm:p-3.5 border border-primary/35 hover:border-primary/60 shadow-sm flex flex-col gap-[2px] relative overflow-hidden h-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${hintClass}`}
                >
                    <div className="flex flex-col justify-between items-start relative z-10 w-full">
                        <span className="text-[12px] sm:text-[13px] text-primary font-black uppercase tracking-wider">Nhật ký</span>
                        <div className="w-full">
                            {rows.length > 0 ? (
                                <div className="flex flex-col mt-1.5 gap-2">
                                    {rows.map((r) => (
                                        <div
                                            key={r.key}
                                            className={`${r.isNew ? 'order-enter' : ''} flex items-baseline gap-2 px-1 -mx-1 rounded text-[12px] font-bold uppercase tracking-tight leading-snug text-white`}
                                        >
                                            <span className="shrink-0 text-[11px] font-semibold tabular-nums leading-none text-text-secondary">{r.time}</span>
                                            <span className="line-clamp-1">
                                                {r.isNew ? <Typewriter text={r.text} /> : r.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-[13px] font-bold text-text-secondary">Chưa có đơn</span>
                            )}
                        </div>
                    </div>
                </div>

            </div>
            {/* empty:hidden — notice trả null thì không chừa khoảng trống */}
            <div className="px-6 mt-3 empty:hidden [&>button]:rounded-[14px]">{notice}</div>
        </header>
    )
}
