import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { useProducts } from '../../contexts/ProductContext'
import { formatVND } from '../../utils'
import type { RepeatedMissingCupCandidate } from '../../utils/inventory'

// PROTOTYPE — "có thể pha bán nhưng chưa bấm bill". Trình bày cùng kiểu thẻ Tổng hao hụt ngay trên (tiêu đề + kết quả ở đầu, vạch,
// rồi các dòng). Mỗi dòng = 1 ly đã pha, viết thành phép cộng công thức: "1 ly + 1 nắp + 17 g cà phê = 1 ly Cà phê đen" — cộng cả
// các dòng ra đúng bằng hao hụt hôm nay (phân rã ở findMissingCupCandidates, có thể lẫn nhiều món). Dòng cuối: tiền két lệch ≈ giá bán.
// Tự ẩn khi không có ứng viên đủ tin cậy.
// cash = { diff: Thực thu − Doanh thu hôm nay (thẻ "So sánh" ở Báo cáo), system: Doanh thu hệ thống }; null = chưa nhập thực thu.
// Gợi ý để soi lại, KHÔNG phải kết luận.
type Cash = { diff: number; system: number }

const MAX_CUPS = 6
const fmtN = (x: number) => Math.round(x * 10) / 10

export default function MissingCupSuspicionCard({ candidates = [], cash = null }: { candidates?: RepeatedMissingCupCandidate[]; cash?: Cash | null }) {
    const { ingredientUnits } = useProducts()
    // Món lặp lại nhiều ngày đáng tin hơn (attachRepeatHistory đã sort lên đầu), rồi tới % khớp.
    const c = candidates[0]
    if (!c) return null
    const n = c.estimatedCups
    const restCups = n - c.cups.length // ly có hụt nhưng không món nào đỡ nổi phần hao hụt còn lại
    // Giá bán của chính các ly đã tách (mỗi món một giá); ly chưa rõ món tính theo giá món chính của nghi vấn.
    const total = c.cups.reduce((s, cup) => s + cup.price, 0) + restCups * (c.estimatedRevenue / n)
    const cashOk = !!cash && cash.diff > 0 && Math.abs(cash.diff - total) <= Math.max(5000, total * 0.2) // ≈: tiền két ít khi khớp 100% (làm tròn, bill lẻ, tip)
    const isCup = (ingredient: string) => /^(ly|nắp)/.test(ingredientLabel(ingredient).toLowerCase())
    // Viết gọn: ly/nắp 1 cái thì chỉ ghi tên ("ly + nắp"), còn lại "17g cà phê" (đơn vị ngắn dính liền số).
    const term = ({ ingredient, amount }: { ingredient: string; amount: number }) => {
        const name = ingredientLabel(ingredient).toLowerCase()
        if (isCup(ingredient)) return amount === 1 ? name : `${fmtN(amount)} ${name}`
        const unit = getIngredientUnit(ingredient, undefined, ingredientUnits)
        return `${fmtN(amount)}${unit.length <= 2 ? '' : ' '}${unit} ${name}`
    }
    // Thứ tự đọc: cà phê → nguyên liệu khác → ly/nắp.
    const rank = (ingredient: string) => isCup(ingredient) ? 2 : /^cà phê/.test(ingredientLabel(ingredient).toLowerCase()) ? 0 : 1
    const byCupLast = (a: { ingredient: string }, b: { ingredient: string }) => rank(a.ingredient) - rank(b.ingredient)
    // Một ly = một dòng ngang: "17g cà phê + 36ml sữa đặc + ly + nắp" bên trái, "= món" sát phải.
    const equation = (key: string | number, rows: { ingredient: string; amount: number }[], result: string) => (
        <div key={key} className="flex items-baseline justify-between gap-2 text-[12px] leading-snug">
            <span className="text-text-secondary">{[...rows].sort(byCupLast).map(term).join(' + ')}</span>
            <span className="font-bold text-warning whitespace-nowrap shrink-0">= {result}</span>
        </div>
    )

    return (
        <div className="bg-surface rounded-[20px] px-3 py-3 border border-warning/30 shadow-sm">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-black text-text uppercase">Khả năng bấm thiếu</span>
                <span className="text-[14px] font-black tabular-nums text-warning truncate">{n} ly</span>
            </div>
            <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1.5">
                {c.cups.slice(0, MAX_CUPS).map((cup, i) => equation(i, cup.rows, cup.name))}
                {c.cups.length > MAX_CUPS && <span className="text-[11px] text-text-dim">… và {c.cups.length - MAX_CUPS} ly nữa</span>}
                {restCups > 0 && equation('rest', c.rest, `${restCups} ly chưa rõ món`)}
            </div>
            {cash && (
                <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1 text-[12px] tabular-nums">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text-secondary">Thực thu lệch</span>
                        <span className="font-bold text-text">{formatVND(Math.abs(cash.diff))}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text-secondary">Giá bán {n} ly</span>
                        <span className={`font-bold ${cashOk ? 'text-warning' : 'text-text-dim'}`}>{cashOk ? '≈ ' : ''}{formatVND(total)}</span>
                    </div>
                </div>
            )}
        </div>
    )
}
