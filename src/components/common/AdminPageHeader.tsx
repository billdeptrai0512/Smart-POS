import { ArrowLeft, RefreshCw } from 'lucide-react'
import { ICON_BTN, ICON_BTN_MUTED } from './ModalShell'

// Header chuẩn của các trang admin — cùng kiểu với HistoryHeader (nút back, ô pill cam ở giữa, nút phải):
// tiêu đề trong pill + dòng phụ nhỏ bên dưới, nút phải là làm mới.
export default function AdminPageHeader({ title, subtitle, onBack, onRefresh }: { title: string; subtitle?: string; onBack: () => void; onRefresh: () => void }) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 xl:px-8 gap-3">
            <button onClick={onBack} className={ICON_BTN}>
                <ArrowLeft size={20} strokeWidth={2.5} />
            </button>
            <div className="flex-1 min-w-0 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center">
                <span className="text-[12px] font-black text-primary uppercase line-clamp-1">{title}</span>
                {subtitle && <span className="text-[12px] font-bold text-text/80 leading-none mt-0.5">{subtitle}</span>}
            </div>
            <button onClick={onRefresh} className={ICON_BTN_MUTED}>
                <RefreshCw size={16} strokeWidth={2.5} />
            </button>
        </header>
    )
}
