// Dòng tiêu đề phân nhóm menu: ------{name}------
// Là một product row với is_divider=true (dùng chung sort_order per-address),
// render full-width (col-span-2) trong grid 2 cột của /pos và /category.
import { ChevronDown } from 'lucide-react'

interface Props {
    name: string
    onClick?: () => void
    // Truyền onToggle để hiện nút thu gọn/mở rộng nhóm ở bên phải.
    collapsed?: boolean
    onToggle?: () => void
}

export default function MenuDivider({ name, onClick, collapsed, onToggle }: Props) {
    return (
        // Có onToggle: bấm vào đâu trên dòng cũng thu gọn/mở rộng (nút mũi tên chỉ để báo trạng thái + bàn phím).
        // Tên nhóm có onClick (sửa tên ở trang Menu) thì chặn nổi bọt để không thu gọn cùng lúc.
        <div
            onClick={onToggle}
            className={`col-span-2 flex items-center gap-3 min-w-0 ${onToggle ? 'py-1 cursor-pointer active:opacity-70' : ''}`}
        >
            {onClick ? (
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onClick() }}
                    className="text-[12px] font-black uppercase tracking-widest text-text-secondary truncate max-w-[70%] cursor-pointer active:opacity-70"
                >
                    {name}
                </button>
            ) : (
                <span className="text-[12px] font-black uppercase tracking-widest text-text-secondary truncate max-w-[70%]">{name}</span>
            )}
            <span className="flex-1 h-px bg-border" />
            {onToggle && (
                <button
                    type="button"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? `Mở rộng ${name}` : `Thu gọn ${name}`}
                    className="shrink-0 p-1 text-text-secondary cursor-pointer active:opacity-70"
                >
                    <ChevronDown size={18} className={`transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                </button>
            )}
        </div>
    )
}
