import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { onboardingHintClass } from '../../utils/onboardingHint'
import { BottomSheet } from './ModalShell'

// Bottom-sheet của dải notice (PrepPinBar, WarehousePrepNotice): icon + tiêu đề bên trái, số đếm + nút X
// bên phải, danh sách ngay bên dưới. Header đứng yên (nút X luôn trong tầm tay), chỉ danh sách cuộn.
// hintClose: guide khách dùng thử sáng nút X khi việc trong sheet đã xong.
interface Props { icon: ReactNode; title: string; count: number | string; onClose: () => void; children: ReactNode; hintClose?: boolean }

// Thanh tab phía trên header sheet (chuông POS: Bạn cần chuẩn bị / Tồn kho cần bổ sung) — truyền qua context
// để các sheet con (PrepPinBar, WarehousePrepNotice, AddressNotice…) khỏi phải nhận thêm prop.
// hidden: tab không đang xem — sheet vẫn mounted (giữ dữ liệu đã tải, khỏi trượt lên lại) chỉ ẩn đi.
export const SheetTabsContext = createContext<{ tabs: ReactNode; hidden?: boolean }>({ tabs: null })

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
    const { tabs, hidden } = useContext(SheetTabsContext)
    return createPortal(
        <BottomSheet
            onClose={onClose}
            className={hidden ? 'hidden' : ''}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl flex flex-col animate-slide-up max-h-[85dvh] overflow-hidden"
        >
            {/* Có thanh tab: tab là nhãn, nên bỏ hẳn hàng icon/tiêu đề/số đếm; nút ✓ lên cạnh phải thanh tab. */}
            <div className={`flex items-center gap-2 px-5 pt-5 shrink-0 ${tabs ? 'pb-4' : 'pb-3 border-b border-border/40'}`}>
                {tabs ? <div className="flex-1 min-w-0">{tabs}</div> : (
                    <>
                        {icon}
                        <span className="flex-1 min-w-0 truncate text-[16px] font-black text-text">{title}</span>
                        {count !== '' && <span className="shrink-0 text-[13px] font-bold text-text-secondary tabular-nums">{count}</span>}
                    </>
                )}
                <button
                    onClick={onClose}
                    aria-label="Xác nhận"
                    className={`${tabs ? 'w-10 h-10 rounded-[14px]' : 'w-8 h-8 rounded-full'} flex items-center justify-center bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all shrink-0 ${onboardingHintClass(hintClose, 'solid')}`}
                >
                    <Check size={18} strokeWidth={3} />
                </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-5 pt-1 pb-8 [@media(display-mode:standalone)]:pb-[max(env(safe-area-inset-bottom),40px)]">{children}</div>
        </BottomSheet>,
        document.body,
    )
}
