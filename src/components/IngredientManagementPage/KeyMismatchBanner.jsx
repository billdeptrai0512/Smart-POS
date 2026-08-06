import { AlertTriangle, X } from 'lucide-react'

export default function KeyMismatchBanner({ mismatches, onView, onDismiss }) {
    // Đếm tổng cả 4 loại lệch (trước đây chỉ đếm labelCollisions — bỏ sót orphan keys
    // khi không có collision, khiến tiêu đề luôn rơi về câu chung chung không có số).
    const total = mismatches.labelCollisions.length
        + mismatches.orphanRecipeKeys.length
        + mismatches.orphanInventoryKeys.length
        + (mismatches.orphanExtraIngredientKeys?.length || 0)

    return (
        <div className="w-full mb-3 bg-warning/5 border border-warning/40 rounded-[14px] flex items-stretch overflow-hidden">
            <button
                onClick={onView}
                className="flex-1 min-w-0 px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-warning/10 active:scale-[0.99] transition-all"
            >
                <AlertTriangle size={16} className="text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-text font-black text-[12px] leading-tight">
                        {total} nguyên liệu cần đồng bộ dữ liệu
                    </p>
                    <p className="text-text-secondary text-[10px] mt-0.5">Có thể làm sai chi phí nguyên liệu trong báo cáo hao hụt. Bấm để xem &amp; sửa.</p>
                </div>
                <span className="text-warning text-[11px] font-black shrink-0">Xem →</span>
            </button>
            <button
                onClick={onDismiss}
                className="px-3 flex items-center justify-center text-text-secondary hover:text-text hover:bg-warning/10 border-l border-warning/30 transition-colors"
                title="Bỏ qua cảnh báo này"
            >
                <X size={14} />
            </button>
        </div>
    )
}
