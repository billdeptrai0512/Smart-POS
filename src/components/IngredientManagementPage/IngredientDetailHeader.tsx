import { ArrowLeft, Plus } from 'lucide-react'
import { ICON_BTN, ICON_BTN_BASE } from '../common/ModalShell'

interface Props {
    title: string
    subtitle?: string | null
    onBack: () => void
    viewMode?: string
    onViewModeChange?: (mode: string) => void
    onAdd?: () => void
    addTitle?: string
}

const TABS = [
    { key: 'details', label: 'Thông tin' },
    { key: 'history', label: 'Nhật ký' },
]

// Mirrors MenuPageHeader layout but swaps the 3-way MenuTabsBar (Công thức/
// Nguyên liệu/Bao bì — the user is already drilled into a specific NVL, that
// switch is noise here) for a 2-way Thông tin/Nhật ký tab bar in the same style.
export default function IngredientDetailHeader({
    title,
    subtitle,
    onBack,
    viewMode = 'details',
    onViewModeChange,
    onAdd,
    addTitle = 'Nhập kho',
}: Props) {
    return (
        <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className={ICON_BTN}
                    title="Trở về"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>

                <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                    <span className="text-[12px] font-black text-primary uppercase line-clamp-1 truncate w-full">{title}</span>
                    {subtitle && (
                        <span className="text-[12px] font-bold text-text/80 leading-none mt-1 tabular-nums">{subtitle}</span>
                    )}
                </div>

                {/* Không có nút thì giữ chỗ 40px để ô tiêu đề luôn cân tâm với nút Back. */}
                {onAdd ? (
                    <button
                        onClick={onAdd}
                        className={`${ICON_BTN_BASE} bg-primary text-bg hover:bg-primary/90 active:scale-95 transition-all`}
                        title={addTitle}
                    >
                        <Plus size={20} strokeWidth={2.5} />
                    </button>
                ) : (
                    <div className="w-10 shrink-0" aria-hidden="true" />
                )}
            </div>

            {onViewModeChange && (
                <div className="bg-surface-light border border-border/50 rounded-[14px] flex p-1 gap-1 shadow-sm">
                    {TABS.map(tab => {
                        const active = viewMode === tab.key
                        return (
                            <button
                                key={tab.key}
                                onClick={() => onViewModeChange(tab.key)}
                                className={`flex-1 flex items-center justify-center py-2 rounded-[10px] transition-all duration-200 ${active ? 'bg-primary shadow-sm' : 'hover:bg-border/30'}`}
                            >
                                <span className={`text-[11px] font-black uppercase tracking-wider transition-colors ${active ? 'text-bg' : 'text-text-secondary'}`}>
                                    {tab.label}
                                </span>
                            </button>
                        )
                    })}
                </div>
            )}
        </header>
    )
}
