import { useState } from 'react'
import { Search, ChevronDown, Info } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import { formatVND } from '../../utils'
import CollapsibleCard from './CollapsibleCard'
import type { RepeatedMissingCupCandidate } from '../../utils/inventory'

// PROTOTYPE — "có thể pha bán nhưng chưa bấm bill": chỉ đích danh 1 nghi vấn khớp nhất (món + số ly + % hao hụt
// giải thích được — thuật toán ở findMissingCupCandidates, src/utils/inventory.ts). Tự ẩn khi không có ứng viên đủ
// tin cậy. Bằng chứng (nguyên liệu khớp) mở khi bấm. Đây là gợi ý để soi lại, KHÔNG phải kết luận — giải thích sau (i).
// cashDiff = Chênh lệch két hôm nay (thẻ "So sánh" ở Báo cáo): két dư ≈ tiền mấy ly ước tính → bằng chứng thứ 2, nối 2 thẻ
// thành 1 câu chuyện. null = chưa nhập thực thu.
export default function MissingCupSuspicionCard({ candidates = [], cashDiff = null }: { candidates?: RepeatedMissingCupCandidate[]; cashDiff?: number | null }) {
    const [open, setOpen] = useState(true)
    const [showInfo, setShowInfo] = useState(false)
    const [expanded, setExpanded] = useState(false)
    // Món lặp lại nhiều ngày đáng tin hơn (attachRepeatHistory đã sort lên đầu), rồi tới % khớp.
    const c = candidates[0]
    if (!c) return null
    const cashMatch = cashDiff != null && Math.abs(cashDiff - c.estimatedRevenue) <= Math.max(2000, c.estimatedRevenue * 0.1)

    return (
        <CollapsibleCard
            icon={<Search size={15} className="text-warning shrink-0" />}
            title="Nghi vấn bán thiếu ghi nhận"
            titleExtra={
                <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setShowInfo(s => !s) }}
                    className="text-text-dim shrink-0"
                >
                    <Info size={11} />
                </span>
            }
            open={open}
            onToggle={() => setOpen(o => !o)}
            borderClass="border-warning/30"
        >
            <div className="flex flex-col gap-2">
                {showInfo && (
                    <div className="px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 text-[10.5px] text-text-secondary leading-snug">
                        Hao hụt hôm nay khớp đúng định lượng của N ly một món — có thể đã pha bán nhưng chưa bấm
                        bill. % = phần giá trị hao hụt mà giả thuyết này giải thích được. Món <b>lặp lại nhiều ngày</b> đáng
                        tin hơn — đây chỉ là <b>gợi ý để soi lại</b>, không phải kết luận chắc chắn.
                    </div>
                )}
                <div className="rounded-[14px] border border-border/60 bg-surface-light px-3 py-2.5 flex flex-col">
                    <button type="button" onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between gap-2 text-left">
                        <div className="flex flex-col min-w-0 gap-0.5">
                            <span className="text-[13px] font-bold text-text">
                                Thiếu <span className="text-warning">{c.estimatedCups} ly {c.productName}</span>
                            </span>
                            {/* 1 dòng bằng chứng: két dư khớp tiền mấy ly (mạnh nhất) → không thì % hao hụt khớp; lặp nhiều ngày thì kèm. */}
                            <span className="text-[11px] text-text-dim tabular-nums">
                                {cashMatch ? 'Khớp két dư' : `Khớp ${Math.round(c.confidence * 100)}% hao hụt`}
                                {c.repeatDays > 0 && <span className="text-danger font-bold"> · lặp {c.repeatDays} ngày</span>}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[13px] font-black text-warning tabular-nums">{formatVND(c.estimatedRevenue)}</span>
                            <ChevronDown size={13} className={`text-text-dim shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                    </button>

                    {expanded && (
                        <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1.5">
                            <div className="flex flex-wrap gap-1.5">
                                {c.matches.map(m => (
                                    <span
                                        key={m.ingredient}
                                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30 tabular-nums"
                                    >
                                        {ingredientLabel(m.ingredient)}: hụt {Math.abs(m.haoHut)} ≈ {m.ratio.toFixed(1)} ly
                                    </span>
                                ))}
                            </div>
                            <div className="text-[10px] text-text-dim">
                                Giá trị nguyên liệu hụt tương ứng: <span className="font-bold text-danger">{formatVND(Math.round(c.ingredientValue))}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </CollapsibleCard>
    )
}
