import { ArrowLeft, Menu } from 'lucide-react'

export default function ReportHeader({ onBack, onOpenSettings, subtitle }) {
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
                <span className="text-[12px] font-medium text-text-secondary">{subtitle}</span>
            </div>

            <button
                onClick={onOpenSettings}
                className="w-10 h-10 flex shrink-0 flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none relative z-10"
                title="Xem báo cáo"
            >
                <Menu size={18} className='text-text' strokeWidth={2.5} />
            </button>
        </header>
    )
}
