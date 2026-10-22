import { ArrowUpRight } from 'lucide-react'

// Chip "nguyên liệu + lượng" bấm vào mở Nhật ký của nguyên liệu đó (không có onOpen thì chỉ là nhãn).
export default function IngredientLogChip({ text, onOpen }: { text: string; onOpen?: () => void }) {
    return (
        <button
            type="button"
            disabled={!onOpen}
            onClick={onOpen}
            className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-full bg-surface-light border border-border/60 text-[12px] font-bold text-text active:scale-95 transition-transform disabled:active:scale-100"
        >
            <span className="truncate max-w-[16rem]">{text}</span>
            {onOpen && <ArrowUpRight size={12} className="text-text-dim shrink-0" />}
        </button>
    )
}
