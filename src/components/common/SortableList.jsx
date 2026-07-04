// Shared sort-mode list — drag rows by the ☰ handle to reorder.
// Used by /recipes (products + dividers) and /ingredients (ingredients).
//
// UX contract (why it's built this way):
//  - The handle is the ONLY drag surface; the rest of the row still scrolls the
//    page, so a thumb resting on the list never reorders by accident.
//  - The lifted row gets shadow + scale; siblings part to preview the drop slot —
//    that moving gap is the affordance that teaches the gesture by itself.
//  - dnd-kit auto-scrolls the scrollable ancestor when dragging near its edges,
//    so long menus (> 1 screen) can be reordered in one drag.
//
// `items`: array of any type
// `getKey(item)`: returns stable key (id for objects, the string itself for plain keys)
// `getLabel(item)`: returns the display string for the row
// `isDivider(item)`: optional — divider rows render as group headings (———  TÊN  ———)
// `onMove(fromIndex, toIndex)`: called on drop (parent does the splice)
import {
    DndContext, PointerSensor, KeyboardSensor,
    closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import {
    SortableContext, useSortable,
    verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

function Row({ id, index, label, divider }) {
    const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id })
    // Scale must ride inside dnd-kit's inline transform — a Tailwind scale class would
    // be overridden by it (inline style wins over class transforms).
    const lifted = isDragging && transform ? { ...transform, scaleX: 1.02, scaleY: 1.02 } : transform
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(lifted), transition }}
            className={`bg-surface border rounded-[14px] pl-4 pr-1 flex items-center gap-3 select-none ${isDragging
                ? 'border-primary shadow-xl shadow-black/30 relative z-10'
                : 'border-border/60'}`}
        >
            <span className="text-text-dim text-[13px] font-bold w-6 text-center shrink-0">{index + 1}</span>
            {divider ? (
                <span className="flex-1 flex items-center gap-3 min-w-0 py-3">
                    <span className="flex-1 h-px bg-border" />
                    <span className="text-[12px] font-black uppercase tracking-widest text-text-secondary truncate">{label}</span>
                    <span className="flex-1 h-px bg-border" />
                </span>
            ) : (
                <span className="flex-1 text-[14px] font-bold text-text truncate py-3">{label}</span>
            )}
            {/* touch-none so a touch on the handle drags instead of scrolling; the rest
                of the row keeps native scroll. p-3 ≈ 44px touch target. */}
            <button
                ref={setActivatorNodeRef}
                {...attributes}
                {...listeners}
                aria-label={`Kéo để di chuyển ${label}`}
                className="p-3 -my-px shrink-0 touch-none cursor-grab active:cursor-grabbing text-text-dim hover:text-text-secondary rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
                <GripVertical size={18} />
            </button>
        </div>
    )
}

export default function SortableList({ items, getKey, getLabel, isDivider, onMove }) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )
    const keys = items.map(getKey)
    const handleDragEnd = ({ active, over }) => {
        if (!over || active.id === over.id) return
        onMove(keys.indexOf(active.id), keys.indexOf(over.id))
    }
    return (
        <div className="space-y-1.5">
            <p className="text-[12px] text-text-secondary font-bold text-center pb-1.5">
                Giữ <GripVertical size={12} className="inline -mt-0.5" /> và kéo để sắp xếp
            </p>
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={handleDragEnd}
            >
                <SortableContext items={keys} strategy={verticalListSortingStrategy}>
                    {items.map((item, index) => (
                        <Row
                            key={keys[index]}
                            id={keys[index]}
                            index={index}
                            label={getLabel(item)}
                            divider={isDivider ? isDivider(item) : false}
                        />
                    ))}
                </SortableContext>
            </DndContext>
        </div>
    )
}
