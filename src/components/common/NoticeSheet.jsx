import { X } from 'lucide-react'
import { BottomSheet } from './ModalShell'

// Bottom-sheet của dải notice (PrepPinBar, WarehousePrepNotice): icon + tiêu đề bên trái, số đếm + nút X
// bên phải, danh sách ngay bên dưới.
export default function NoticeSheet({ icon, title, count, onClose, children }) {
    return (
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-1 animate-slide-up max-h-[85dvh] overflow-y-auto"
        >
            <div className="flex items-center gap-2 pb-3 border-b border-border/40">
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
            {children}
        </BottomSheet>
    )
}
