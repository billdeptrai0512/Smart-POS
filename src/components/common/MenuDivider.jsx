// Dòng tiêu đề phân nhóm menu: ------{name}------
// Là một product row với is_divider=true (dùng chung sort_order per-address),
// render full-width (col-span-2) trong grid 2 cột của /pos và /recipes.
// `dragHandleProps` (tùy chọn) = {ref, attributes, listeners} từ dnd-kit useSortable —
// khi có, 2 đường kẻ đổi thành nét đứt và CHÍNH LÀ bề mặt kéo-thả (không cần icon
// riêng nữa) để sắp xếp trực tiếp trên /recipes. Tên mục vẫn là nơi bấm để sửa/xoá,
// tách khỏi 2 đường kẻ nên không tranh chấp gesture kéo vs tap.
export default function MenuDivider({ name, onClick, dragHandleProps }) {
    return (
        <div className="col-span-2 flex items-center gap-3 min-w-0">
            {dragHandleProps ? (
                // Vùng chạm cao ~28px (ẩn) — đường nét đứt mỏng nằm giữa, chỉ để hiển thị.
                <span
                    ref={dragHandleProps.ref}
                    {...dragHandleProps.attributes}
                    {...dragHandleProps.listeners}
                    className="flex-1 h-7 flex items-center touch-none cursor-grab active:cursor-grabbing"
                >
                    <span className="w-full border-t border-dashed border-border" />
                </span>
            ) : (
                <span className="flex-1 h-px bg-border" />
            )}
            <button
                type="button"
                onClick={onClick}
                disabled={!onClick}
                className={`text-[12px] font-black uppercase tracking-widest text-text-secondary truncate max-w-[70%] ${onClick ? 'cursor-pointer active:opacity-70' : 'cursor-default'}`}
            >
                {name}
            </button>
            {dragHandleProps ? (
                <span
                    ref={dragHandleProps.ref}
                    {...dragHandleProps.attributes}
                    {...dragHandleProps.listeners}
                    className="flex-1 h-7 flex items-center touch-none cursor-grab active:cursor-grabbing"
                >
                    <span className="w-full border-t border-dashed border-border" />
                </span>
            ) : (
                <span className="flex-1 h-px bg-border" />
            )}
        </div>
    )
}
