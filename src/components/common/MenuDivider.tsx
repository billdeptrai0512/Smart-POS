// Dòng tiêu đề phân nhóm menu: ------{name}------
// Là một product row với is_divider=true (dùng chung sort_order per-address),
// render full-width (col-span-2) trong grid 2 cột của /pos và /category.
interface Props {
    name: string
    onClick?: () => void
}

export default function MenuDivider({ name, onClick }: Props) {
    return (
        <div className="col-span-2 flex items-center gap-3 min-w-0">
            <span className="flex-1 h-px bg-border" />
            <button
                type="button"
                onClick={onClick}
                disabled={!onClick}
                className={`text-[12px] font-black uppercase tracking-widest text-text-secondary truncate max-w-[70%] ${onClick ? 'cursor-pointer active:opacity-70' : 'cursor-default'}`}
            >
                {name}
            </button>
            <span className="flex-1 h-px bg-border" />
        </div>
    )
}
