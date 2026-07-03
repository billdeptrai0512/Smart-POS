// Dòng tiêu đề phân nhóm menu: ------{name}------
// Là một product row với is_divider=true (dùng chung sort_order per-address),
// render full-width (col-span-2) trong grid 2 cột của /pos và /recipes.
export default function MenuDivider({ name, onClick }) {
    return (
        <div
            onClick={onClick}
            className={`col-span-2 flex items-center gap-3 py-1 min-w-0 ${onClick ? 'cursor-pointer active:opacity-70' : ''}`}
        >
            <span className="flex-1 h-px bg-border" />
            <span className="text-[12px] font-black uppercase tracking-widest text-text-secondary truncate max-w-[70%]">{name}</span>
            <span className="flex-1 h-px bg-border" />
        </div>
    )
}
