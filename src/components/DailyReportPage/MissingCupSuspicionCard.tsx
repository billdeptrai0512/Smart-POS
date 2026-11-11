import { useState } from 'react'
import { Search } from 'lucide-react'
import { ingredientLabel } from '../../utils/ingredients'
import { formatVND } from '../../utils'
import CollapsibleCard from './CollapsibleCard'
import type { RepeatedMissingCupCandidate } from '../../utils/inventory'

// PROTOTYPE — "có thể pha bán nhưng chưa bấm bill": 1 nghi vấn khớp nhất (món + số ly), kể bằng 2 bằng chứng độc lập
// dẫn về cùng 1 con số ly: KÉT (Thực thu − Doanh thu = tiền của mấy ly) và KHO (mỗi nguyên liệu hụt ≈ mấy ly).
// Thuật toán ở findMissingCupCandidates (src/utils/inventory.ts). Tự ẩn khi không có ứng viên đủ tin cậy.
// cash = { diff: Thực thu − Doanh thu hôm nay (thẻ "So sánh" ở Báo cáo), system: Doanh thu hệ thống }; null = chưa nhập thực thu.
// Gợi ý để soi lại, KHÔNG phải kết luận (tiêu đề "Nghi vấn" đã nói đủ, không cần chú thích thêm).
type Cash = { diff: number; system: number }

// Tối giản: 1 màu nhấn (kết luận), còn lại trung tính. Mọi bằng chứng quy về CÙNG đơn vị "ly" và so với vạch N ly của kết luận
// — đọc từ trên xuống: kết luận → từng bằng chứng (nhãn · thanh · số ly), thanh nào chạm vạch thì khớp.
function Row({ label, cups, max, n, first = false }: { label: string; cups: number | null; max: number; n: number; first?: boolean }) {
    return (
        <div className="grid grid-cols-[96px_1fr_60px] items-center gap-3 text-[12px] tabular-nums">
            <span className="text-text-secondary truncate">{label}</span>
            <div className="relative h-1.5 rounded-full bg-surface-light">
                {cups != null && <div className="h-full rounded-full bg-text-secondary/60" style={{ width: `${Math.max(3, Math.min(100, (cups / max) * 100))}%` }} />}
                <div className="absolute -top-1 -bottom-1 w-px bg-warning" style={{ left: `${(n / max) * 100}%` }}>
                    {first && <span className="absolute -top-3.5 -translate-x-1/2 text-[9px] font-bold text-warning whitespace-nowrap">{n} ly</span>}
                </div>
            </div>
            <span className="font-bold text-text text-right">{cups != null ? `${cups.toFixed(1)} ly` : '—'}{cups != null && Math.abs(cups - n) <= 0.5 && <span className="text-warning"> ✓</span>}</span>
        </div>
    )
}

export default function MissingCupSuspicionCard({ candidates = [], cash = null }: { candidates?: RepeatedMissingCupCandidate[]; cash?: Cash | null }) {
    const [open, setOpen] = useState(true)
    // Món lặp lại nhiều ngày đáng tin hơn (attachRepeatHistory đã sort lên đầu), rồi tới % khớp.
    const c = candidates[0]
    if (!c) return null
    const n = c.estimatedCups
    const price = c.estimatedRevenue / n
    const cashCups = cash ? Math.max(0, cash.diff) / price : 0
    const max = Math.max(n, cashCups, ...c.matches.map(m => m.ratio)) * 1.05 // vạch n + thanh dài nhất cùng nằm trong khung

    return (
        <CollapsibleCard
            icon={<Search size={15} className="text-warning shrink-0" />}
            title="Nghi vấn bán thiếu ghi nhận"
            open={open}
            onToggle={() => setOpen(o => !o)}
            borderClass="border-warning/30"
        >
            <div className="flex flex-col gap-2.5">
                {/* px-3 = cùng lề với khối bằng chứng bên dưới: nhãn thẳng cột với tên món, tiền thẳng cột với số ly */}
                <div className="flex items-baseline justify-between gap-3 px-3 pb-1">
                    <div className="min-w-0 truncate">
                        <span className="text-[15px] font-black text-warning">{n} ly {c.productName}</span>
                        {c.repeatDays > 0 && <span className="ml-2 text-[10.5px] font-bold text-text-dim">lặp {c.repeatDays} ngày</span>}
                    </div>
                    <span className="text-[16px] font-black text-warning tabular-nums shrink-0">{formatVND(c.estimatedRevenue)}</span>
                </div>

                {/* Bằng chứng, cùng đơn vị ly; vạch cam = số ly kết luận */}
                <div className="flex flex-col gap-3 rounded-[14px] bg-surface-light/60 px-3 pb-4 pt-6">
                    <Row label={cash ? (cash.diff >= 0 ? 'Thực thu dư' : 'Thực thu thiếu') : 'Thực thu'} cups={cash ? Math.max(0, cash.diff) / price : null} max={max} n={n} first />
                    {[...c.matches].sort((a, b) => b.ratio - a.ratio).map(m => (
                        <Row key={m.ingredient} label={ingredientLabel(m.ingredient)} cups={m.ratio} max={max} n={n} />
                    ))}
                </div>
            </div>
        </CollapsibleCard>
    )
}
