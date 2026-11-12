import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients'
import { useProducts } from '../../contexts/ProductContext'
import { formatVND } from '../../utils'
import type { RepeatedMissingCupCandidate } from '../../utils/inventory'

// PROTOTYPE — "có thể pha bán nhưng chưa bấm bill". Cùng kiểu thẻ Tổng hao hụt ngay trên (tiêu đề + tổng ở đầu, vạch, các dòng).
// Mỗi ly = tên món + giá (phải), công thức "17g cà phê + 36ml sữa đặc + ly + nắp" (dưới) — cộng các ly ra đúng hao hụt hôm nay
// (phân rã ở findMissingCupCandidates, có thể lẫn nhiều món). Cuối thẻ: giá bán cả N ly so với tiền két lệch (≈).
// Tự ẩn khi không có ứng viên đủ tin cậy.
// cash = { diff: Thực thu − Doanh thu hôm nay (thẻ "So sánh" ở Báo cáo), system: Doanh thu hệ thống }; null = chưa nhập thực thu.
// Gợi ý để soi lại, KHÔNG phải kết luận.
type Cash = { diff: number; system: number }

const MAX_CUPS = 6
const fmtN = (x: number) => Math.round(x * 10) / 10

export default function MissingCupSuspicionCard({ candidates = [], cash = null }: { candidates?: RepeatedMissingCupCandidate[]; cash?: Cash | null }) {
    const { ingredientUnits } = useProducts()
    const [open, setOpen] = useState(true) // thu gọn → chỉ còn tiêu đề + số ly
    // Món lặp lại nhiều ngày đáng tin hơn (attachRepeatHistory đã sort lên đầu), rồi tới % khớp.
    const c = candidates[0]
    if (!c) return null
    const restCups = c.restCups // ly có hụt nhưng không món nào đỡ nổi phần hao hụt còn lại
    const n = c.cups.length + restCups
    if (!n) return null
    // Giá bán của chính các ly đã tách (mỗi món một giá); ly chưa rõ món tính theo giá món chính của nghi vấn.
    const restPrice = restCups * c.estimatedRevenue / c.estimatedCups
    const total = c.cups.reduce((s, cup) => s + cup.price, 0) + restPrice
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
    // Một ly = 2 dòng: tên món (nổi) rồi công thức "17g cà phê + 36ml sữa đặc + ly + nắp" (nền nhạt) — không bao giờ rớt chữ lẻ.
    const equation = (key: string | number, rows: { ingredient: string; amount: number }[], result: string, price: number) => (
        <div key={key} className="leading-snug">
            <div className="flex items-baseline justify-between gap-2 text-[12px] font-semibold tabular-nums">
                <span className="text-text">{result}</span>
                <span className="text-text-secondary">{formatVND(price)}</span>
            </div>
            {/* Mỗi nguyên liệu là 1 khối không bẻ giữa chừng, "+" dính vào đầu khối sau → chỉ xuống dòng GIỮA các nguyên liệu, và cân đều 2 dòng. */}
            <div className="text-[12px] text-text-dim max-w-[85%] text-balance">
                {[...rows].sort((a, b) => rank(a.ingredient) - rank(b.ingredient)).map((r, j) => <Fragment key={j}><span className="whitespace-nowrap">{j > 0 && '+ '}{term(r)}</span> </Fragment>)}
            </div>
        </div>
    )

    return (
        <div className="bg-surface rounded-[20px] px-3 py-3 border border-warning/30 shadow-sm">
            <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2">
                <span className="text-[14px] font-black text-text uppercase">Khả năng bấm thiếu</span>
                <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[14px] font-black tabular-nums text-warning truncate">{n} ly</span>
                    <ChevronDown size={16} className={`shrink-0 text-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
            </button>
            {open && (<>
            <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1.5">
                {c.cups.slice(0, MAX_CUPS).map((cup, i) => equation(i, cup.rows, cup.name, cup.price))}
                {c.cups.length > MAX_CUPS && <span className="text-[11px] text-text-dim">… và {c.cups.length - MAX_CUPS} ly nữa</span>}
                {restCups > 0 && equation('rest', c.rest, `${restCups} ly chưa rõ món`, restPrice)}
            </div>
            {cash && (
                <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1 text-[12px] tabular-nums">
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text-secondary">Giá bán {n} ly</span>
                        <span className="font-semibold text-text">{formatVND(total)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="text-text-secondary">{cash.diff < 0 ? 'Thực thu thiếu' : 'Thực thu lệch'}</span>
                        <span className={`font-bold ${cash.diff < 0 ? 'text-danger' : cashOk ? 'text-warning' : 'text-text-dim'}`}>{cash.diff < 0 ? '−' : cashOk ? '≈ ' : ''}{formatVND(Math.abs(cash.diff))}</span>
                    </div>
                    {cash.diff < 0 && <span className="text-[11px] text-text-dim">Két không dư nên chưa chốt được số ly — soi lại bill</span>}
                </div>
            )}
            </>)}
        </div>
    )
}
