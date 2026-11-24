import { useEffect, useRef } from 'react'
import Typewriter from '../Typewriter'
import Collapse from './Collapse'

// Dải guide thứ hai của khách dùng thử: mở ra dưới thẻ vừa giải thích, chữ gõ dần, bấm để sang bước sau (viền hint nhấp nháy).
// Nằm ngoài viewport thì cuộn nhẹ tới. pt-3 nằm trong phần bị cắt nên co cùng dải.
export default function GuideTapRow({ show, text, onTap }: { show: boolean; text: string; onTap: () => void }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!show) return
        const t = setTimeout(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350)
        return () => clearTimeout(t)
    }, [show])
    return (
        <Collapse show={show}>
            <div className="pt-3">
                <div ref={ref} onClick={onTap} className="flex items-center justify-center h-10 px-4 rounded-[14px] bg-primary/15 text-text text-center uppercase tracking-wider text-[12px] font-black cursor-pointer active:scale-[0.98] transition-transform onboarding-hint">
                    {show && <Typewriter text={text} />}
                </div>
            </div>
        </Collapse>
    )
}
