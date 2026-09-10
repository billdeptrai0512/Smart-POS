import { X, Loader } from 'lucide-react'

// Shared overlay shell behind every bottom-sheet / centered-dialog modal in the
// app — the "fixed inset-0 + backdrop + panel" boilerplate was copy-pasted into
// 15+ files. Panel content/classes stay fully caller-owned (panelClassName);
// only the overlay + backdrop + dismiss-on-backdrop-click wiring is shared.

// Slides up from the bottom (mobile action-sheet style). Backdrop click closes;
// clicking the panel itself does not (stopPropagation), since the outer wrapper
// — not the backdrop — owns the close handler here.
export function BottomSheet({ onClose, zIndexClass = 'z-[100]', className = '', panelClassName, children }) {
    return (
        <div className={`fixed inset-0 ${zIndexClass} flex items-end justify-center ${className}`} onClick={onClose}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
            <div className={`relative ${panelClassName}`} onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    )
}

// Centered dialog. The backdrop (not the wrapper) owns the close handler, so the
// panel needs no stopPropagation — it's a sibling, never a bubble target of a
// backdrop click.
export function Dialog({ onClose, zIndexClass = 'z-50', className = '', panelClassName, children }) {
    return (
        <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center ${className}`}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className={`relative ${panelClassName}`}>
                {children}
            </div>
        </div>
    )
}

// panelClassName dùng chung cho các Dialog kiểu "trang con có nút quay lại" (chọn bàn
// đích, danh sách đơn mang đi, chi tiết bàn) — cùng khung bottom-sheet-trên-desktop nên
// tách 1 lần thay vì mỗi modal tự khai lại chuỗi class.
export const MODAL_PANEL = 'w-full max-w-md mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden'

// Khuôn nút chip tròn (trạng thái ra món, nút hành động nhỏ trên mỗi đợt/đơn) — dùng ở
// TableDetailModal + TakeawayListModal.
export const CHIP = 'h-[26px] rounded-full border text-[11px] font-black uppercase tracking-wider transition-colors'
export const CHIP_IDLE = `${CHIP} bg-surface-light border-border/60 text-text-secondary`

// Pill ngày/giờ mở đợt/đơn — tách riêng ngày và giờ thành 2 pill cạnh nhau (thay vì 1
// chuỗi text) để dễ quét mắt hơn khi liệt kê nhiều đợt/đơn liên tiếp. Cùng h-[26px] với
// CHIP để pill và nút chip tròn đứng cạnh nhau (xem TableDetailModal) cao bằng nhau.
export const TIME_PILL = 'h-[26px] inline-flex items-center rounded-full bg-surface-light border border-border/60 px-2.5 text-[11px] font-bold text-text-secondary/70 leading-none'

// Header dùng chung cho modal dạng panel: icon vuông (tuỳ chọn) + tiêu đề (+ dòng phụ
// tuỳ chọn) + nút đóng — cùng 1 khối markup lặp lại y hệt ở 8+ modal trước đây.
// hideClose (thay vì disabled) khi đang xử lý (lưu/xoá) — người dùng không đóng ngang
// giữa lúc thao tác chưa xong.
export function ModalHeader({ icon: Icon, iconColorClass = 'text-primary', iconBgClass = 'bg-primary/10', title, subtitle, subtitleClassName = '', onClose, hideClose = false, className = '' }) {
    return (
        <div className={`flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 ${className}`}>
            <div className="flex items-center gap-2.5">
                {Icon && (
                    <div className={`w-8 h-8 rounded-[10px] ${iconBgClass} flex items-center justify-center`}>
                        <Icon size={15} className={iconColorClass} />
                    </div>
                )}
                {subtitle ? (
                    <div>
                        <p className="text-text font-black text-sm leading-none">{title}</p>
                        <p className={`text-text-secondary text-xs mt-0.5 ${subtitleClassName}`}>{subtitle}</p>
                    </div>
                ) : (
                    <p className={`text-text font-black leading-none ${Icon ? 'text-sm' : 'text-base'}`}>{title}</p>
                )}
            </div>
            {!hideClose && (
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                >
                    <X size={16} />
                </button>
            )}
        </div>
    )
}

// Header dùng cho bottom-sheet đơn giản (chỉ tiêu đề, không icon vuông) + nút đóng
// tròn viền — dáng khác ModalHeader (ghost icon-button, dùng trong Dialog có icon
// vuông); pattern này lặp lại y hệt ở 10+ sheet trước đây.
export function SheetHeader({ title, onClose, closeDisabled = false, className = '' }) {
    return (
        <div className={`flex items-center justify-between ${className}`}>
            <span className="text-[16px] font-black text-text">{title}</span>
            <button
                onClick={onClose}
                disabled={closeDisabled}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50 shrink-0"
            >
                <X size={16} />
            </button>
        </div>
    )
}

// Cặp nút Hủy/Xác nhận dùng chung cho modal dạng form/confirm — lặp lại y hệt ở 6+
// modal trước đây. confirmType='submit' cho modal bọc trong <form onSubmit>
// (không gắn onClick, để form tự submit); 'button' thì gọi onConfirm trực tiếp.
export function ModalActions({ confirmLabel, onCancel, onConfirm, confirmType = 'button', loading = false, confirmDisabled = false, danger = false }) {
    return (
        <div className="flex gap-2">
            <button
                type="button"
                disabled={loading}
                onClick={onCancel}
                className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
            >
                Hủy
            </button>
            <button
                type={confirmType}
                disabled={loading || confirmDisabled}
                onClick={confirmType === 'button' ? onConfirm : undefined}
                className={`flex-1 py-3 rounded-[14px] font-black text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${danger ? 'bg-danger text-white hover:bg-danger/90' : 'bg-primary text-black hover:bg-primary/90'}`}
            >
                {loading ? <Loader size={14} className="animate-spin" /> : confirmLabel}
            </button>
        </div>
    )
}
