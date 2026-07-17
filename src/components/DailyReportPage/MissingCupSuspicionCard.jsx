import { useState } from 'react'
import { Search, ChevronDown, Info } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import { formatVND } from '../../utils'

// PROTOTYPE — hiện gợi ý "có thể pha bán nhưng chưa bấm bill" khi hao hụt của
// NHIỀU nguyên liệu trong cùng 1 công thức cùng khớp ra 1 số ly (xem thuật toán ở
// findMissingCupCandidates, src/utils/inventory.js). Tự ẩn khi không có ứng viên
// nào đủ tin cậy — không tạo noise cho ca không có gì bất thường.
//
// Đây là gợi ý nghi vấn (heuristic dựa trên trùng khớp định lượng), KHÔNG phải kết
// luận chắc chắn — hao hụt nhiều nguyên liệu trùng tỉ lệ vẫn có thể do nguyên nhân
// khác (công thức sai định lượng, đổ nhầm nguyên liệu giữa các món...). Giải thích
// đầy đủ nằm sau icon (i), không hiện mặc định — user chỉ cần đọc 1 lần.
//
// Mỗi ứng viên co gọn còn 1 dòng (tên + badge lặp lại + số ly + doanh thu ước tính),
// bấm mới mở phần "bằng chứng" (nguyên liệu khớp + giá trị nguyên liệu hụt) — cùng
// pattern collapse-by-default với IngredientRow trong InventoryReportCard, tránh
// bày hết thông tin ra cùng lúc cho 1 tính năng chỉ mang tính gợi ý phụ.
export default function MissingCupSuspicionCard({ candidates = [] }) {
    const [open, setOpen] = useState(true)
    const [showInfo, setShowInfo] = useState(false)
    if (!candidates.length) return null

    return (
        <div className="bg-surface rounded-[20px] p-3 border border-warning/30 shadow-sm">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}
            >
                <div className="flex items-center gap-1.5">
                    <Search size={15} className="text-warning shrink-0" />
                    <span className="text-[12px] font-black uppercase tracking-widest text-text">Nghi vấn bán thiếu ghi nhận</span>
                    <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setShowInfo(s => !s) }}
                        className="text-text-dim shrink-0"
                    >
                        <Info size={11} />
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-bold text-text-secondary tabular-nums">{candidates.length}</span>
                    <ChevronDown size={16} className={`text-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
            </button>

            {open && (
                <div className="flex flex-col gap-2">
                    {showInfo && (
                        <div className="px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 text-[10.5px] text-text-secondary leading-snug">
                            Hao hụt nhiều nguyên liệu cùng khớp ra 1 số ly — có thể đã pha bán nhưng
                            chưa bấm bill. Món <b>lặp lại nhiều ngày</b> đáng tin hơn nhiều so với chỉ
                            xuất hiện 1 lần — đây chỉ là <b>gợi ý để soi lại</b>, không phải kết luận chắc chắn.
                        </div>
                    )}
                    {candidates.map(c => <CandidateRow key={c.productId} c={c} />)}
                </div>
            )}
        </div>
    )
}

function CandidateRow({ c }) {
    const [expanded, setExpanded] = useState(false)
    return (
        <div className="rounded-[14px] border border-border/60 bg-surface-light px-3 py-2.5 flex flex-col">
            <button type="button" onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between gap-2">
                <div className="flex flex-col items-start min-w-0 gap-0.5">
                    <span className="text-[13px] font-bold text-text truncate">{c.productName}</span>
                    <span className={`text-[9.5px] font-black tabular-nums ${c.repeatDays > 0 ? 'text-danger' : 'text-text-dim'}`}>
                        {c.repeatDays > 0 ? `Lặp lại ${c.repeatDays}/${c.repeatWindowDays} ngày` : 'Lần đầu thấy'}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <div className="flex flex-col items-end gap-0.5">
                        <span className="text-[13px] font-black text-warning tabular-nums">≈ {c.estimatedCups} ly</span>
                        <span className="text-[10px] text-text-dim tabular-nums">{formatVND(c.estimatedRevenue)}</span>
                    </div>
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
                                {ingredientLabel(m.ingredient)}: hụt {Math.abs(m.haoHut)}
                            </span>
                        ))}
                    </div>
                    <div className="text-[10px] text-text-dim">
                        Giá trị nguyên liệu hụt tương ứng: <span className="font-bold text-danger">{formatVND(Math.round(c.ingredientValue))}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
