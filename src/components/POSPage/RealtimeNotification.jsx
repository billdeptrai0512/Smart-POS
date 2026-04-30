import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { formatVND } from '../../utils'

const VISIBLE_MS = 5000
const EXIT_MS = 300

export default function RealtimeNotification({ notification, onClose }) {
    // `closing` is only set asynchronously by the auto-hide timer (not
    // synchronously in the effect body), so React doesn't cascade renders.
    // Entry animation runs from a CSS keyframe that auto-plays on mount,
    // which avoids needing a `visible` state we'd have to flip in an effect.
    const [closing, setClosing] = useState(false)

    // Reset `closing` during render when a new notification arrives, instead
    // of setting it inside the effect (which would cascade).
    const [shownId, setShownId] = useState(null)
    const currentId = notification ? `${notification.title}|${notification.total}` : null
    if (currentId !== shownId) {
        setShownId(currentId)
        setClosing(false)
    }

    useEffect(() => {
        if (!notification) return
        const closeTimer = setTimeout(() => setClosing(true), VISIBLE_MS)
        const removeTimer = setTimeout(onClose, VISIBLE_MS + EXIT_MS)
        return () => {
            clearTimeout(closeTimer)
            clearTimeout(removeTimer)
        }
    }, [notification, onClose])

    if (!notification) return null

    return (
        <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 w-[90%] max-w-[360px] ${closing
                ? '-translate-y-12 opacity-0 scale-95'
                : 'translate-y-0 opacity-100 scale-100 animate-[notification-in_300ms_ease-out]'
                }`}
        >
            <div className="bg-primary border border-primary/20 shadow-lg rounded-2xl p-4 flex items-start gap-3 text-bg text-left relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-white/20">
                    <div className="h-full bg-white/80 animate-[shrink_5s_linear_forwards]" />
                </div>

                <div className="mt-1 shrink-0 bg-white/20 p-2 rounded-full">
                    <Bell size={20} className="text-white" />
                </div>

                <div className="flex-1 min-w-0 pr-4">
                    <h4 className="text-[14px] font-black uppercase tracking-wider mb-1">
                        {notification?.title || 'Có đơn mới!'}
                    </h4>
                    <p className="text-[13px] font-medium opacity-90 truncate">
                        {notification?.description}
                    </p>
                    <p className="text-[15px] font-black mt-1">
                        + {formatVND(notification?.total || 0)}
                    </p>
                </div>

                <button
                    onClick={() => setClosing(true)}
                    className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/20 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
            </div>
        </div>
    )
}
