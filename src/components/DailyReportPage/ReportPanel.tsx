import type { ReactNode, Ref } from 'react'

interface PanelProps {
    title: string
    /** Dòng tổng cuối panel, sau một vạch kẻ. */
    total?: { label: string; value: ReactNode; className: string }
    className?: string
    panelRef?: Ref<HTMLDivElement>
    children: ReactNode
}

// Khung panel của báo cáo (Thực thu / Thực chi / Thực nhận / các thẻ Doanh thu, Giá vốn…): tiêu đề, nội dung, vạch, dòng tổng.
export function ReportPanel({ title, total, className = '', panelRef, children }: PanelProps) {
    return (
        <div ref={panelRef} className={`w-full bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group ${className}`}>
            <h3 className="text-[14px] font-black text-text/90 uppercase tracking-wider mb-3 pl-1">{title}</h3>
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
