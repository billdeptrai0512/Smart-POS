import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { onboardingHintClass } from '../../utils/onboardingHint'
import { BottomSheet } from './ModalShell'

// Bottom-sheet của dải notice (PrepPinBar, WarehousePrepNotice): icon + tiêu đề bên trái, số đếm + nút X
// bên phải, danh sách ngay bên dưới. Header đứng yên (nút X luôn trong tầm tay), chỉ danh sách cuộn.
// hintClose: guide khách dùng thử sáng nút X khi việc trong sheet đã xong.
interface Props { icon: ReactNode; title: string; count?: number | string; onClose: () => void; children: ReactNode; hintClose?: boolean }

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

// Portal ra body: dải notice nằm TRONG header POS (relative z-20 = stacking context riêng), không portal thì sheet z-[100]
// bị kẹt ở tầng 20 của header và nút ✕/số lượng (z-20) trên thẻ món đè lên sheet.
export default function NoticeSheet({ icon, title, count, onClose, children, hintClose = false }: Props) {
    return createPortal(
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl flex flex-col animate-slide-up max-h-[85dvh] overflow-hidden"
        >
            {/* Cùng kiểu header "Điều hướng" (TopNav): ô vuông 40px hai bên, tiêu đề in hoa ở giữa. */}
            <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                <span className="w-10 h-10 shrink-0 flex items-center justify-center rounded-[14px] bg-bg border border-border/60">{icon}</span>
                {/* Tiêu đề dài thì cắt bớt, số đếm đứng ngoài phần cắt để không bị mất. */}
                <p className="flex-1 min-w-0 flex items-center justify-center gap-2 text-text font-black text-sm leading-6 uppercase tracking-wide">
                    <span className="truncate">{title}</span>
                    {count !== undefined && count !== '' && <span className="shrink-0 text-text-secondary tabular-nums">{count}</span>}
                </p>
                <button
                    onClick={onClose}
                    aria-label="Xác nhận"
                    className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-[14px] bg-bg border border-border/60 active:bg-border/20 text-text-secondary hover:text-text transition-all ${onboardingHintClass(hintClose, 'solid')}`}
                >
                    <Check size={19} strokeWidth={3} />
                </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 pt-1 pb-8 [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),40px)]">{children}</div>
        </BottomSheet>,
        document.body,
    )
}
