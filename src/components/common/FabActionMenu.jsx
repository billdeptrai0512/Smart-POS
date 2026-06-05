import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'

// Collapsed FAB that expands to a vertical stack of action buttons on tap.
// Outside-tap / Escape collapses back. Each item is a { icon, label, onClick }
// that triggers and auto-closes the menu.
//
// Sits at the same position as the original inline FAB row, so callers swap in
// place without rearranging layout. The menu opens UPWARD (above the trigger)
// so it doesn't clip on screens where the FAB sits near the bottom edge.
export default function FabActionMenu({ items = [] }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const onPointer = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false)
        }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onPointer)
        document.addEventListener('touchstart', onPointer)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onPointer)
            document.removeEventListener('touchstart', onPointer)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    return (
        <div ref={ref} className="flex flex-col items-end gap-2">
            {open && items.map((item, i) => (
                <button
                    key={item.key || i}
                    onClick={() => { item.onClick?.(); setOpen(false) }}
                    style={{ animationDelay: `${i * 30}ms` }}
                    className="bg-surface border border-border/60 rounded-[12px] px-4 py-2.5 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider text-text-secondary hover:bg-surface-light active:scale-95 transition-all shadow-sm animate-slide-up"
                >
                    {item.icon}
                    {item.label}
                </button>
            ))}
            <button
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-label={open ? 'Đóng menu' : 'Mở menu hành động'}
                className={`rounded-[12px] px-4 py-2.5 flex items-center justify-center text-[13px] font-bold active:scale-95 transition-all border ${
                    open
                        ? 'bg-surface-light border-primary/40 text-primary shadow-sm'
                        : 'bg-primary border-primary text-bg shadow-lg shadow-primary/30 hover:bg-primary/90'
                }`}
            >
                {open ? <X size={18} /> : <MoreHorizontal size={18} />}
            </button>
        </div>
    )
}
