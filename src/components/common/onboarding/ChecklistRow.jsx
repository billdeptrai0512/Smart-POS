import { Check } from 'lucide-react'

export default function ChecklistRow({ label, done }) {
    // 10px × 1.25 (scale của OnboardingGuide) = 12.5px — to hơn mức cũ 11px
    // nhưng vẫn nhỏ hơn tiêu đề thẻ và chữ trên header POS.
    return (
        <div className="flex items-center justify-between gap-1.5 text-[10px] w-full text-left">
            <span className={done ? 'text-text-dim line-through' : 'text-text-secondary'}>{label}</span>
            <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border shrink-0 ${done ? 'bg-primary border-primary' : 'border-text-dim'}`}>
                {done && <Check size={10} strokeWidth={3} className="text-bg" />}
            </span>
        </div>
    )
}
