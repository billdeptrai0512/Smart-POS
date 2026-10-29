import { formatVND } from '../../utils'

// Hàng "Tổng cộng N ly | Doanh thu X" ở đầu danh sách đơn (Nhật ký) và thẻ Doanh thu (Báo cáo).
// Dùng chung cho tab Chi phí qua props nhãn/màu (mặc định = Bán hàng).
interface Props { cups: number; revenue: number; leftLabel?: string; unit?: string; rightLabel?: string; rightTone?: string }

export default function CupsRevenueSummary({ cups, revenue, leftLabel = 'Tổng cộng', unit = 'ly', rightLabel = 'Doanh thu', rightTone = 'text-success' }: Props) {
    return (
        <div className="flex w-full items-start justify-between">
            <div className="flex flex-col min-w-0 flex-1 mt-1">
                <span className="text-[12px] font-black text-text uppercase mb-1">{leftLabel}</span>
                <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                    {cups} {unit}
                </span>
            </div>
            <div className="flex flex-col items-end shrink-0 ml-3">
                <span className="text-[12px] font-black text-text uppercase mb-0.5">{rightLabel}</span>
                <span className={`text-[17px] font-bold tabular-nums leading-none ${revenue > 0 ? rightTone : 'text-text-secondary'}`}>
                    {formatVND(revenue || 0)}
                </span>
            </div>
        </div>
    )
}
