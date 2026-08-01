import { Check } from 'lucide-react'

export default function ChecklistRow({ label, done }) {
    return (
        <div className="flex items-center justify-between gap-1.5 text-[11px] w-full text-left">
            <span className={done ? 'text-text-dim line-through' : 'text-text-secondary'}>{label}</span>
            <span className={`flex items-center justify-center w-3.5 h-3.5 rounded-[4px] border shrink-0 ${done ? 'bg-primary border-primary' : 'border-text-dim'}`}>
                {done && <Check size={10} strokeWidth={3} className="text-bg" />}
            </span>
        </div>
    )
}
