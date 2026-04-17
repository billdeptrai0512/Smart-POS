import { ArrowLeft, Pencil } from 'lucide-react'

export default function ReportHeader({ onBack, onEditShiftClosing }) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center justify-between px-4">
            <button
                onClick={onBack}
                className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none relative z-10"
                title="Trở về"
            >
                <ArrowLeft size={20} strokeWidth={2.5} />
            </button>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pt-2">
                <h1 className="text-[16px] font-black uppercase text-primary tracking-wider truncate px-24">Báo Cáo</h1>
                <span className="text-[12px] font-medium text-text-secondary">{new Date().toLocaleDateString('vi-VN')}</span>
            </div>

            {onEditShiftClosing ? (
                <button
                    onClick={onEditShiftClosing}
                    className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-light border border-primary/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none relative z-10"
                    title="Chỉnh sửa chốt ca"
                >
                    <Pencil size={18} className='text-primary/80' strokeWidth={2.5} />
                </button>
            ) : (
                <div className="w-10 h-10 shrink-0 relative z-10" />
            )}
        </header>
    )
}
