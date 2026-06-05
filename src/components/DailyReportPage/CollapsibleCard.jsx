import { ChevronDown } from 'lucide-react'

// Khung card thu gọn/mở rộng dùng chung cho khu Tồn kho (Soạn / Hao hụt / Chuẩn bị).
// Controlled: `open` + `onToggle` do parent giữ — parent chạy accordion (mỗi lúc mở 1 card,
// mặc định mở card của bước hiện tại trong flow). `count` là chuỗi nhỏ cạnh chevron (vd "4/4").
export default function CollapsibleCard({ icon, title, count, open, onToggle, children }) {
    return (
        <div className="bg-surface rounded-[20px] p-3 border border-border/60 shadow-sm">
            <button
                type="button"
                onClick={onToggle}
                className={`w-full flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}
            >
                <div className="flex items-center gap-1.5">
                    {icon}
                    <span className="text-[12px] font-black uppercase tracking-widest text-text">{title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {count != null && (
                        <span className="text-[11px] font-bold text-text-secondary tabular-nums">{count}</span>
                    )}
                    <ChevronDown size={16} className={`text-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
                </div>
            </button>
            {open && children}
        </div>
    )
}
