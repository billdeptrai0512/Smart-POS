import { useState, useEffect, type ReactNode, type Ref } from 'react'
import { onboardingHintClass } from '../../utils/onboardingHint'
import type { LastOrder } from '../../services/cartOps'

// Types the committed order's text out left→right — only runs once "Tạo đơn" is pressed
// (tapping a product no longer writes to the journal, so it can't be mistaken for "sent").
function Typewriter({ text }: { text: string }) {
    const [n, setN] = useState(0)
    useEffect(() => {
        if (n >= text.length) return
        const id = setTimeout(() => setN(n + 1), 25)
        return () => clearTimeout(id)
    }, [n, text.length])
    return <>{text.slice(0, n)}{n < text.length && <span className="opacity-50">▌</span>}</>
}

interface Props {
    dayName: string
    dateOnly: string
    onOpenHistory: () => void
    addressName?: string | null
    onAddressClick: () => void
    recentOrders?: LastOrder[]
    enterKey: string | null
    showOnboardingHint?: boolean
    takeawaySlotRef: Ref<HTMLDivElement>
    notice?: ReactNode // dải notice dưới 2 thẻ, vẫn trong header (PrepPinBar)
}

export default function Header({ dayName, dateOnly, onOpenHistory, addressName, onAddressClick, recentOrders = [], enterKey, showOnboardingHint = false, takeawaySlotRef, notice }: Props) {
    const hintClass = onboardingHintClass(showOnboardingHint, 'solid')
    // Saved orders only, newest first (max 3). isNew matches only the exact row just
    // committed locally (enterKey) → it slides in and types out; the realtime DB echo,
    // which remounts the row under a new server-timestamp key, can't replay it.
    const rows = recentOrders.map(o => ({
        key: o.id ?? o.createdAt, // id is collision-proof; createdAt (ms) can repeat on same-tick commits
        isNew: o.createdAt === enterKey,
        text: o.items.join(' · '),
    })).slice(0, 3)
    return (
        <header className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            <div className="px-6 grid grid-cols-2 dine-split:grid-cols-4 gap-3 mb-1">
                {/* Card 1: Address & Status */}
                <div
                    onClick={onAddressClick}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer bg-bg hover:bg-surface active:bg-border/20 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-[20px] p-3 sm:p-3.5 border border-border/60 shadow-sm flex flex-col justify-center gap-[2px] relative overflow-hidden h-full"
                >
                    <div className="flex flex-col justify-between items-start relative z-10 w-full">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-black uppercase tracking-wider">Địa chỉ</span>
                        <div className="flex items-center justify-between w-full mt-0.5">
                            {addressName && <span className="text-[13px] text-success font-black uppercase tracking-wider line-clamp-1">{addressName}</span>}
                        </div>
                    </div>
                    <div className="w-full h-[1px] bg-border/60 rounded-full relative z-10 my-[3px] mt-[4px]"></div>
                    <div className="flex flex-col justify-between items-start relative z-10 mt-[6px]">
                        <span className="text-[13px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">{dayName}</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[14px] sm:text-[14px] text-text font-black uppercase tracking-tight">{dateOnly}</span>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 w-24 h-24 bg-success/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                </div>

                {/* Card 2: Revenue / Cost / Profit */}
                <div
                    onClick={onOpenHistory}
                    role="button"
                    tabIndex={0}
                    className={`dine-split:col-span-2 cursor-pointer bg-bg rounded-[20px] p-3 sm:p-3.5 border border-primary/35 hover:border-primary/60 shadow-sm flex flex-col gap-[2px] relative overflow-hidden h-full transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${hintClass}`}
                >
                    <div className="flex flex-col justify-between items-start relative z-10 w-full">
                        <div className="flex items-center justify-between w-full">
                            <span className="text-[12px] sm:text-[13px] text-primary font-black uppercase tracking-wider">Nhật ký</span>
                        </div>
                        <div className="w-full">
                            {rows.length > 0 ? (
                                <div className="flex flex-col mt-1.5 gap-2">
                                    {rows.map((r) => (
                                        <div
                                            key={r.key}
                                            className={`${r.isNew ? 'order-enter' : ''} flex items-baseline gap-2 px-1 -mx-1 rounded text-[12px] font-bold uppercase tracking-tight leading-snug text-white`}
                                        >
                                            <span className="shrink-0 text-[15px] leading-none text-white/70">•</span>
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

                {/* Cột 4 (tablet): thẻ Mang đi — TableModal inline portal vào đây, state
                    + modal danh sách vẫn ở TableModal. [&>*]:h-full: cao bằng hàng header
                    thay vì CARD_H của lưới bàn. [&>*]:w-full: tile tĩnh (chưa có đơn) là
                    <button>, ngoài grid thì chỉ rộng vừa chữ. */}
                <div ref={takeawaySlotRef} className="hidden dine-split:block [&>*]:h-full [&>*]:w-full" />
            </div>
            {/* empty:hidden — notice trả null thì không chừa khoảng trống */}
            <div className="px-6 mt-3 empty:hidden [&>button]:rounded-[14px]">{notice}</div>
        </header >
    )
}
