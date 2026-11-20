import type { ReactNode } from 'react'
import { PILL_TONES } from '../../constants/navStyles'

// Pill hành động — 2 cột, icon nhỏ + label 1 dòng. Dùng chung cho "Lối tắt" (điều hướng)
// và "Quản lý" (sửa/xoá địa chỉ), tone danger cho các thao tác nguy hiểm.
export default function ActionPill({ icon, label, tone = 'primary', active = false, wide = false, onClick }: { icon: ReactNode; label: string; tone?: string; active?: boolean; wide?: boolean; onClick?: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`${wide ? 'col-span-2 ' : ''}flex flex-col items-center gap-1.5 px-2 py-3 rounded-[14px] bg-surface-light border ${active ? 'border-primary/60' : 'border-border/50'} hover:border-primary/40 hover:bg-border/20 active:scale-95 transition-all text-center min-w-0`}
        >
            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${PILL_TONES[tone]}`}>
                {icon}
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-wider leading-tight ${tone === 'danger' ? 'text-danger' : 'text-text'}`}>{label}</span>
        </button>
    )
}
