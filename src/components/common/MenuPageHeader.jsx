import { ArrowLeft, ArrowRight } from 'lucide-react'
import MenuTabsBar from './MenuTabsBar'
import { onboardingHintClass } from '../../utils/onboardingHint'

// Header dùng chung cho /ingredients (Tồn kho) và /recipes (Công thức) — chỉ khác tiêu đề,
// đơn vị đếm ("loại" vs "món") và bộ tab. subtitle (tuỳ chọn) thay dòng đếm — vd. chọn ngày của Kiểm kê. hintBack/hintForward: onboarding gợi ý bấm mũi tên
// tới trang kế (Công thức sau Tồn kho; Tồn kho sau Công thức) — xem onboarding/steps.js.
export default function MenuPageHeader({ title, count, unitLabel, subtitle, onBack, onForward, tabs, activeTab, onTabSelect, hintBack, hintForward }) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className={`w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0 ${onboardingHintClass(hintBack)}`}
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1">{title}</span>
                    {subtitle ?? <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{count} {unitLabel}</span>}
                </div>

                {onForward && (
                    <button
                        onClick={onForward}
                        className={`w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0 ${onboardingHintClass(hintForward)}`}
                        title="Tiếp"
                    >
                        <ArrowRight size={20} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            <MenuTabsBar tabs={tabs} activeTab={activeTab} onSelect={onTabSelect} />
        </header>
    )
}
