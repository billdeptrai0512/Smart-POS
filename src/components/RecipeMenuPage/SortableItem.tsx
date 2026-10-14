// Bọc 1 ô trong lưới /category để kéo-thả trực tiếp trên màn hình chính — không có
// nút "vào chế độ sắp xếp" riêng: nhấn giữ + kéo là bắt đầu, thả tay là commit
// (RecipeMenuPage lưu ngay khi onDragEnd).
//
// Card: `handle` (nút ở cuối hàng card, touch-none) là bề mặt kéo DUY NHẤT — card ở chế độ
// sắp xếp (ProductCard sortMode) không mở món khi tap.
//
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'

interface SortableItemProps {
    id: string
    children: (api: { handle: ReactNode }) => ReactNode
}

export default function SortableItem({ id, children }: SortableItemProps) {
    const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id })
    // Scale phải nằm trong transform inline của dnd-kit — class Tailwind scale sẽ bị
    // transform inline (style) đè mất.
    const lifted = isDragging && transform ? { ...transform, scaleX: 1.03, scaleY: 1.03 } : transform
    const handle = (
        <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            aria-label="Kéo để sắp xếp"
            className="shrink-0 w-10 h-10 -mr-2 flex items-center justify-center rounded-xl text-text-secondary/80 hover:text-text active:bg-border/40 touch-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
            <GripVertical size={16} />
        </button>
    )
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(lifted), transition }}
            className={isDragging ? 'relative z-10' : ''}
        >
            {children({ handle })}
        </div>
    )
}
