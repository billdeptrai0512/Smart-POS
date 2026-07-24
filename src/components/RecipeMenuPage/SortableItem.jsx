// Bọc 1 ô trong lưới /recipes để kéo-thả trực tiếp trên màn hình chính — không có
// nút "vào chế độ sắp xếp" riêng: nhấn giữ + kéo là bắt đầu, thả tay là commit
// (RecipeMenuPage lưu ngay khi onDragEnd).
//
// Card: `handle` (icon góc trên-phải, touch-none) là bề mặt kéo DUY NHẤT — phần
// còn lại vẫn mở món khi tap bình thường.
//
// Mục phân nhóm: dùng `dragHandleProps` thay vì icon riêng — MenuDivider tự áp
// vào 2 đường kẻ đứt của nó (xem MenuDivider.jsx).
//
// Card và mục nằm ở 2 SortableContext riêng biệt (xem RecipeMenuPage) nên
// không còn lệch kích thước khi tính animation "nhường chỗ" — mỗi context chỉ
// có item cùng cỡ với nhau.
//
// `noAnimate`: mục không tự "nhường chỗ" khi kéo mục khác — các mục nằm cách xa
// nhau trên trang (ngăn cách bởi cả khối card), nhảy quãng xa nhìn giật hơn là
// mượt. Chỉ mờ đi tại chỗ khi đang kéo; vị trí thật + ảnh kéo nổi xem
// RecipeMenuPage's DragOverlay. Card không cần cờ này.
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

export default function SortableItem({ id, noAnimate, children }) {
    const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id })
    // Scale phải nằm trong transform inline của dnd-kit — class Tailwind scale sẽ bị
    // transform inline (style) đè mất.
    const lifted = isDragging && transform ? { ...transform, scaleX: 1.03, scaleY: 1.03 } : transform
    const style = noAnimate ? undefined : { transform: CSS.Transform.toString(lifted), transition }
    const handle = (
        <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            aria-label="Kéo để sắp xếp"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-text-dim hover:text-text-secondary hover:bg-surface-light touch-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
            <GripVertical size={16} />
        </button>
    )
    const dragHandleProps = { ref: setActivatorNodeRef, attributes, listeners }
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={isDragging ? (noAnimate ? 'opacity-30' : 'relative z-10') : ''}
        >
            {children({ handle, dragHandleProps, isDragging })}
        </div>
    )
}
