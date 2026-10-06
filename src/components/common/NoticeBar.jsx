import { ChevronRight } from 'lucide-react'

// Dải notice 1 dòng ở đỉnh trang (cùng chỗ OnboardingGuide): icon + nhãn + số đếm + mũi tên. Rộng
// bằng cột nội dung (max-w-lg) để khớp header trang bên dưới; tablet chia đôi thì giãn như header.
export default function NoticeBar({ icon, label, count, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            className="shrink-0 w-full max-w-lg mx-auto dine-split:max-w-none flex items-center gap-2.5 h-10 px-4 text-[14px] font-bold bg-primary/15 text-text text-left"
        >
            {icon}
            <span className="flex-1 truncate uppercase tracking-wider text-[12px] font-black">{label}</span>
            {count > 0 && <span className="text-[12px] font-bold text-text-secondary tabular-nums">{count}</span>}
            <ChevronRight size={16} className="text-text-dim shrink-0" />
        </button>
    )
}
