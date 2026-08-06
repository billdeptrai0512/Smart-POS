import { ArrowLeft, NotebookText } from 'lucide-react'

// Mirrors IngredientsHeader layout but drops MenuTabsBar (the user is already
// drilled into a specific NVL — switching to Công thức from here is noise).
// Chi tiết ↔ Nhật ký chỉ có 2 chế độ nên bỏ hẳn thanh tab, đổi thành 1 nút icon ở
// ô bên phải (chỗ toggle kiểm kê cũ, giờ nằm trong panel Kiểm kê): sáng = đang xem
// nhật ký, bấm lần nữa về chi tiết.
export default function IngredientDetailHeader({
    title,
    subtitle,
    onBack,
    viewMode = 'details',
    onViewModeChange,
}) {
    const showingHistory = viewMode === 'history'
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1 truncate w-full">{title}</span>
                    {subtitle && (
                        <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{subtitle}</span>
                    )}
                </div>

                {onViewModeChange && (
                    <button
                        onClick={() => onViewModeChange(showingHistory ? 'details' : 'history')}
                        title={showingHistory ? 'Về chi tiết' : 'Xem nhật ký'}
                        className={`w-10 h-10 flex items-center justify-center rounded-[14px] border shadow-sm transition-colors focus:outline-none shrink-0 ${
                            showingHistory
                                ? 'bg-primary border-primary text-black'
                                : 'bg-surface-light border-border/60 text-text hover:bg-border/40'
                        }`}
                    >
                        <NotebookText size={20} strokeWidth={2.5} />
                    </button>
                )}
            </div>
        </header>
    )
}
