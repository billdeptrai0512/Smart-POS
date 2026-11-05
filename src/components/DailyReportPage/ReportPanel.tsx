import type { ReactNode, Ref } from 'react'

interface PanelProps {
    title: string
    /** Chú thích nhỏ bên phải tiêu đề (vd giờ nhập). */
    subtitle?: ReactNode
    /** Dòng tổng cuối panel, sau một vạch kẻ. */
    total?: { label: string; value: ReactNode; className: string }
    className?: string
    panelRef?: Ref<HTMLDivElement>
    children: ReactNode
}

// Khung panel của báo cáo (Thực thu / Thực chi / Thực nhận / các thẻ Doanh thu, Giá vốn…): tiêu đề, nội dung, vạch, dòng tổng.
export function ReportPanel({ title, subtitle, total, className = '', panelRef, children }: PanelProps) {
    return (
        <div ref={panelRef} className={`w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group ${className}`}>
            <div className="flex items-center justify-between gap-2 pl-1 pb-3 mb-4 border-b border-border/60">
                <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider">{title}</h3>
                {subtitle && <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.075] px-2 py-0.5 text-[11px] font-bold text-primary/75">{subtitle}</span>}
            </div>
            {children}
            {total && (
                <>
                    <div className="w-full h-[1px] bg-border/60 rounded-full my-3" />
                    <div className="flex justify-between items-center mt-1 pl-1">
                        <span className="text-[13px] font-black text-text uppercase tracking-wide leading-none">{total.label}</span>
                        <span className={`text-[14px] font-black tabular-nums leading-none ${total.className}`}>{total.value}</span>
                    </div>
                </>
            )}
        </div>
    )
}

export function PanelRow({ label, value, valueClassName = 'text-text' }: { label: string; value: ReactNode; valueClassName?: string }) {
    return (
        <div className="flex justify-between items-center">
            <span className="text-[12px] font-bold text-text-secondary">{label}</span>
            <span className={`text-[13px] font-bold tabular-nums ${valueClassName}`}>{value}</span>
        </div>
    )
}
