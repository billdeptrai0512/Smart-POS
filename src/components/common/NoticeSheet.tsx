import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { BottomSheet } from './ModalShell'

// Bottom-sheet của dải notice (PrepPinBar, WarehousePrepNotice): icon + tiêu đề bên trái, số đếm + nút X
// bên phải, danh sách ngay bên dưới. Header đứng yên (nút X luôn trong tầm tay), chỉ danh sách cuộn.
interface Props { icon: ReactNode; title: string; count: number | string; onClose: () => void; children: ReactNode }

// Thân sheet tính bất đồng bộ: lỗi → nút "Thử lại"; đang tính → chữ chờ; xong thì vẽ children.
export function SheetBody({ error, loading, onRetry, children }: { error: unknown; loading: boolean; onRetry: () => void; children: ReactNode }) {
    if (error) {
        return (
            <div className="py-6 text-center flex flex-col items-center gap-2">
                <span className="text-[14px] font-bold text-danger">Không tải được số liệu</span>
                <button type="button" onClick={onRetry} className="text-[13px] font-bold text-primary">Thử lại</button>
            </div>
        )
    }
    return loading ? <SheetSkeleton /> : <>{children}</>
}

// Khung xương mô phỏng dòng "tên + 2 dòng phụ | nút" của danh sách → đỡ cảm giác chờ so với chữ "Đang tính…".
function SheetSkeleton() {
    return (
        <div className="flex flex-col animate-pulse" aria-busy="true" aria-label="Đang tính">
            {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between gap-4 py-3 border-b border-border/30 last:border-0">
                    <div className="flex flex-col gap-2">
                        <div className="h-4 w-28 rounded bg-surface-light" />
                        <div className="h-3 w-40 rounded bg-surface-light" />
                    </div>
                    <div className="h-11 w-28 rounded-[14px] bg-surface-light" />
                </div>
            ))}
        </div>
    )
}

export default function NoticeSheet({ icon, title, count, onClose, children }: Props) {
    return (
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl flex flex-col animate-slide-up max-h-[85dvh] overflow-hidden"
        >
            <div className="flex items-center gap-2 px-5 pt-5 pb-3 border-b border-border/40 shrink-0">
                {icon}
                <span className="flex-1 min-w-0 truncate text-[16px] font-black text-text">{title}</span>
                <span className="shrink-0 text-[13px] font-bold text-text-secondary tabular-nums">{count}</span>
                <button
                    onClick={onClose}
                    aria-label="Đóng"
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all shrink-0"
                >
                    <X size={16} />
                </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 pt-1 pb-8">{children}</div>
        </BottomSheet>
    )
}
