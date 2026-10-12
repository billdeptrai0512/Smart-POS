import { formatVND } from '../../utils'

// Hàng "Tổng cộng N ly | Doanh thu X" ở đầu danh sách đơn (Nhật ký) và thẻ Doanh thu (Báo cáo).
export default function CupsRevenueSummary({ cups, revenue }: { cups: number; revenue: number }) {
    return (
        <div className="flex w-full items-start justify-between">
            <div className="flex flex-col min-w-0 flex-1 mt-1">
                <span className="text-[12px] font-black text-text uppercase mb-1">Tổng cộng</span>
                <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                    {cups} ly
                </span>
            </div>
            <div className="flex flex-col items-end shrink-0 ml-3">
                <span className="text-[12px] font-black text-text uppercase mb-0.5">Doanh thu</span>
                <span className={`text-[17px] font-bold tabular-nums leading-none ${revenue > 0 ? 'text-success' : 'text-text-secondary'}`}>
                    {formatVND(revenue || 0)}
                </span>
            </div>
        </div>
    )
}
